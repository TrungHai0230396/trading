import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runScan, type ScanProgress } from "@/lib/scanner/runner";
import { ALL_TIMEFRAMES } from "@/lib/scanner/candles";
import { DEFAULT_STRATEGY } from "@/lib/scanner/strategies";

const requestSchema = z
  .object({
    market: z.enum(["FOREX", "CRYPTO"]),
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
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
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

  // Stream progress + result as NDJSON. Each line is a separate JSON
  // object the client can parse incrementally:
  //   {"type":"progress","phase":"CONSENSUS","done":47,"total":100}
  //   {"type":"result","data":{...}}
  //   {"type":"error","error":"..."}
  const userId = session.user.id;
  const input = parsed.data;
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Lỗi không xác định";
        send({ type: "error", error: msg });
      } finally {
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
