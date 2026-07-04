import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { tradingSystemUpsertSchema } from "@/lib/trading-systems/schema";
import {
  DEFAULT_SYSTEM_TEMPLATE,
  serializeTradingSystem,
} from "@/lib/trading-systems/serialize";

/**
 * GET /api/trading-systems
 * Returns all non-archived systems for the current user, with items eager-
 * loaded. If the user has none yet, a default starter template is seeded
 * and returned. This is the on-demand seed described in the design doc.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  let systems = await db.tradingSystem.findMany({
    where: { userId, archived: false },
    include: { items: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (systems.length === 0) {
    // First-time seed.
    const seeded = await db.tradingSystem.create({
      data: {
        userId,
        name: DEFAULT_SYSTEM_TEMPLATE.name,
        notes: DEFAULT_SYSTEM_TEMPLATE.notes,
        isDefault: true,
        items: {
          create: DEFAULT_SYSTEM_TEMPLATE.items.map((item, idx) => ({
            label: item.label,
            required: item.required,
            order: idx,
          })),
        },
      },
      include: { items: true },
    });
    systems = [seeded];
  }

  return NextResponse.json({
    items: systems.map(serializeTradingSystem),
  });
}

/**
 * POST /api/trading-systems
 * Create a new system with its items.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  const parsed = tradingSystemUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    // If this one is to become default, unset any prior default.
    if (input.isDefault) {
      await db.tradingSystem.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const created = await db.tradingSystem.create({
      data: {
        userId,
        name: input.name,
        notes: input.notes ?? null,
        isDefault: input.isDefault,
        items: {
          create: input.items.map((item, idx) => ({
            label: item.label,
            required: item.required,
            order: idx,
          })),
        },
      },
      include: { items: true },
    });

    return NextResponse.json(serializeTradingSystem(created), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Không thể tạo hệ thống";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
