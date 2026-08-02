import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runScan, type ScanProgress } from "@/lib/scanner/runner";
import { ALL_TIMEFRAMES } from "@/lib/scanner/candles";
import { DEFAULT_STRATEGY } from "@/lib/scanner/strategies";
import { rateLimit } from "@/lib/brokers/rate-limit";

// A single run fans out up to ~50 symbols × 7 TFs (+100 consensus-universe
// symbols) of UNCACHED candle fetches and persists a run + its results. It
// is by far the heaviest endpoint, so the per-user cap is strict.
const MAX_RUNS_PER_HOUR = 10;
// Keep only this many most-recent runs per user — bounds MySQL + nightly
// backup growth even under sustained (rate-limited) use.
const RUN_RETENTION_PER_USER = 100;

// ─── In-flight guard ────────────────────────────────────────────────────
// MAX_RUNS_PER_HOUR is counted when a request ARRIVES, so it is blind to
// runs that are still executing: a user can fire all ten allowances at the
// same instant and each one fans out thousands of uncached Binance calls.
// Every outbound call leaves from the SAME server IP, so that burst can get
// us rate-limited (or banned) upstream — which breaks prices, portfolio,
// live journal quotes and the shared consensus alerts for EVERY user — and
// pegs the event loop of our single Node process on top of it.
//
// Hence: one run per user at a time, plus a small ceiling across all users
// so a handful of accounts can't coordinate the very same burst. Both are
// admission checks on a heavy endpoint, not a shared upstream budget — a
// blocked caller is told to retry, nothing else is starved.
const MAX_CONCURRENT_RUNS = 3;
// Safety net for a slot whose `finally` never ran (stream aborted before
// it started, the process wedged mid-run, an unexpected throw). Without it
// one leaked entry would lock that user out of scanning until the next
// deploy. Well above the slowest real scan (~1-2 min for the 100-symbol
// consensus universe × 7 timeframes at CONCURRENCY 5).
const RUN_SLOT_TTL_MS = 10 * 60_000;

// userId → epoch ms the run started. Bounded by MAX_CONCURRENT_RUNS plus
// however many stale entries the TTL has yet to reclaim, so it stays tiny.
const runningScans = new Map<string, number>();

type SlotGrant =
  | { ok: true; startedAt: number }
  | { ok: false; reason: "USER_BUSY" | "SYSTEM_BUSY" };

// Check and set happen with no `await` in between, so two concurrent
// requests can never both win a slot on this single-threaded runtime.
function acquireRunSlot(userId: string): SlotGrant {
  const now = Date.now();
  for (const [uid, startedAt] of runningScans) {
    if (now - startedAt > RUN_SLOT_TTL_MS) runningScans.delete(uid);
  }

  if (runningScans.has(userId)) return { ok: false, reason: "USER_BUSY" };
  if (runningScans.size >= MAX_CONCURRENT_RUNS) {
    return { ok: false, reason: "SYSTEM_BUSY" };
  }

  runningScans.set(userId, now);
  return { ok: true, startedAt: now };
}

function releaseRunSlot(userId: string, startedAt: number): void {
  // Release only OUR entry: a run that outlived RUN_SLOT_TTL_MS was already
  // reclaimed and the user may hold a newer slot we must not free.
  if (runningScans.get(userId) === startedAt) runningScans.delete(userId);
}

const requestSchema = z
  .object({
    // Crypto-only scanner — forex removed (shared TwelveData key can't
    // sustain a multi-symbol × multi-TF scan on the free tier).
    market: z.enum(["CRYPTO"]),
    symbols: z.array(z.string().min(2).max(20)).max(50),
    timeframes: z
      .array(z.enum(ALL_TIMEFRAMES as [string, ...string[]]))
      .min(1)
      .max(ALL_TIMEFRAMES.length),
    // Single strategy. Field accepted for backward-compat but ignored.
    indicators: z.array(z.enum(["ema-wma-on-rsi"])).optional(),
    limitPerTF: z.coerce.number().int().min(50).max(1000).optional(),
    name: z.string().max(120).optional(),
    includeConsensusTop: z.boolean().optional(),
  })
  .refine(
    (data) => data.symbols.length > 0 || data.includeConsensusTop === true,
    {
      message: "Cần chọn ít nhất 1 symbol hoặc bật Top 10 đồng thuận",
      path: ["symbols"],
    },
  );

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  if (!rateLimit(`scanner-run:${session.user.id}`, MAX_RUNS_PER_HOUR, 60 * 60_000)) {
    return NextResponse.json(
      {
        error:
          "Bạn đã chạy quá nhiều lượt quét trong giờ này. Thử lại sau ít phút.",
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  const userId = session.user.id;
  const input = parsed.data;

  // Taken here — before the Response is returned — because the scan itself
  // only starts once the stream below is pulled; checking any later would
  // leave the burst window wide open.
  const slot = acquireRunSlot(userId);
  if (!slot.ok) {
    return slot.reason === "USER_BUSY"
      ? NextResponse.json(
          {
            error:
              "Bạn đang có một lượt quét chạy dở. Đợi lượt đó xong rồi quét tiếp nhé.",
          },
          { status: 409 },
        )
      : NextResponse.json(
          {
            error:
              "Hệ thống đang bận xử lý các lượt quét khác. Thử lại sau ít phút.",
          },
          { status: 503 },
        );
  }
  const slotStartedAt = slot.startedAt;

  // Stream progress + result as NDJSON. Each line is a separate JSON
  // object the client can parse incrementally:
  //   {"type":"progress","phase":"CONSENSUS","done":47,"total":100}
  //   {"type":"result","data":{...}}
  //   {"type":"error","error":"..."}
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      // Emit an initial event immediately so the client knows the
      // stream is alive and starts showing the progress UI before any
      // symbol finishes. The total is set as soon as runScan picks it.
      const initialTotal =
        input.includeConsensusTop ? 100 : input.symbols.length;
      const initialPhase: ScanProgress["phase"] =
        input.includeConsensusTop ? "CONSENSUS" : "USER_SYMBOLS";
      send({
        type: "progress",
        phase: initialPhase,
        done: 0,
        total: initialTotal,
      });
      // 1 KB of padding for any intermediary that needs a buffer to fill
      // before flushing the first frame (compression, reverse proxies).
      // Comment lines are ignored by NDJSON readers — we prefix with
      // whitespace + newline.
      controller.enqueue(encoder.encode(" ".repeat(1024) + "\n"));

      // No throttle: ~100 events over 30-60s is trivial, and the UI
      // benefits from seeing 1, 2, 3, … rather than skips.
      const onProgress = (p: ScanProgress) => {
        send({ type: "progress", ...p });
      };

      try {
        const result = await runScan({
          userId,
          ...input,
          indicators: [DEFAULT_STRATEGY],
          onProgress,
        });
        send({ type: "result", data: result });

        // Best-effort retention prune — bound DB/backup growth. Never let a
        // prune failure surface as a scan error; the result is already sent.
        try {
          const stale = await db.analysisRun.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            skip: RUN_RETENTION_PER_USER,
            select: { id: true },
          });
          if (stale.length > 0) {
            await db.analysisRun.deleteMany({
              where: { id: { in: stale.map((s) => s.id) } },
            });
          }
        } catch {
          // swallow — retention is housekeeping, not user-facing
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Lỗi không xác định";
        send({ type: "error", error: msg });
      } finally {
        // Release FIRST: on a client disconnect `controller.close()` throws
        // (the controller is already closed), and a throw here would strand
        // the slot and lock this user out of scanning for the whole TTL.
        releaseRunSlot(userId, slotStartedAt);
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Disable buffering on nginx and similar reverse proxies.
      "X-Accel-Buffering": "no",
      // Skip gzip — compressors typically wait for ≥1KB of body before
      // flushing, which delays small progress packets noticeably.
      "Content-Encoding": "identity",
    },
  });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("pageSize") ?? "20") || 20),
  );

  const [items, total] = await Promise.all([
    db.analysisRun.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        results: {
          orderBy: { score: "desc" },
          select: { symbol: true, score: true },
        },
      },
    }),
    db.analysisRun.count({ where: { userId: session.user.id } }),
  ]);

  return NextResponse.json({
    items: items.map((r) => {
      const symbols = (r.symbols as unknown as string[]) ?? [];
      // Pick best symbol by max score across its TFs.
      const byScore = new Map<string, number>();
      for (const row of r.results) {
        const cur = byScore.get(row.symbol) ?? -Infinity;
        if (row.score != null && row.score > cur) {
          byScore.set(row.symbol, row.score);
        }
      }
      const top = [...byScore.entries()].sort((a, b) => b[1] - a[1])[0];

      return {
        id: r.id,
        name: r.name,
        market: r.market,
        createdAt: r.createdAt,
        symbolCount: symbols.length,
        timeframes: r.timeframes,
        indicators: r.indicators,
        topSymbol: top ? { symbol: top[0], score: top[1] } : null,
      };
    }),
    pagination: { page, pageSize, total },
  });
}
