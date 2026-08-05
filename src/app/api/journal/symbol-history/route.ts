import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/brokers/rate-limit";
import { getSymbolHistory } from "@/lib/journal/symbol-history";

const querySchema = z.object({
  symbol: z.string().trim().min(1).max(40),
});

// The UI fires one request per symbol change (debounced, cached for a minute),
// so this only ever bites a script. Each call scans every closed trade on the
// symbol, which is more MySQL than one user should be able to spend at will.
const MAX_LOOKUPS_PER_MINUTE = 60;

/**
 * The signed-in user's own closed history with one symbol. Read-only, and
 * scoped to the session user inside getSymbolHistory — a symbol in the query
 * string never widens the row set beyond the caller's own journal.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!rateLimit(`symbol-history:${userId}`, MAX_LOOKUPS_PER_MINUTE, 60_000)) {
    return NextResponse.json(
      { error: "Xem lịch sử symbol quá nhanh. Thử lại sau ít giây." },
      { status: 429 },
    );
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    symbol: url.searchParams.get("symbol") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Symbol không hợp lệ" }, { status: 400 });
  }

  const history = await getSymbolHistory(userId, parsed.data.symbol);
  return NextResponse.json(history);
}
