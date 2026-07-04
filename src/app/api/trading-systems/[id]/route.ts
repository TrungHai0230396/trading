import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { tradingSystemPatchSchema } from "@/lib/trading-systems/schema";
import { serializeTradingSystem } from "@/lib/trading-systems/serialize";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteCtx) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const { id } = await params;

  const system = await db.tradingSystem.findFirst({
    where: { id, userId: session.user.id },
    include: { items: true },
  });
  if (!system) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }
  return NextResponse.json(serializeTradingSystem(system));
}

/**
 * PATCH replaces fields and (when `items` is provided) the full item set.
 * Items are diffed by id: existing ids are updated, new entries (no id) get
 * inserted, and any current item not in the payload is deleted.
 */
export async function PATCH(req: Request, { params }: RouteCtx) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const existing = await db.tradingSystem.findFirst({
    where: { id, userId },
    include: { items: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  const parsed = tradingSystemPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    // Promote to default → demote others first.
    if (input.isDefault === true) {
      await db.tradingSystem.updateMany({
        where: { userId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }

    await db.tradingSystem.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
    });

    if (input.items !== undefined) {
      const incoming = input.items;
      const incomingIds = new Set(
        incoming.map((i) => i.id).filter(Boolean) as string[],
      );
      const toDelete = existing.items.filter((it) => !incomingIds.has(it.id));

      // Delete removed items.
      if (toDelete.length > 0) {
        await db.tradingSystemItem.deleteMany({
          where: { id: { in: toDelete.map((x) => x.id) } },
        });
      }

      // Upsert each remaining item with its new order.
      for (let idx = 0; idx < incoming.length; idx++) {
        const item = incoming[idx];
        if (item.id) {
          await db.tradingSystemItem.update({
            where: { id: item.id },
            data: {
              label: item.label,
              required: item.required,
              order: idx,
            },
          });
        } else {
          await db.tradingSystemItem.create({
            data: {
              systemId: id,
              label: item.label,
              required: item.required,
              order: idx,
            },
          });
        }
      }
    }

    const fresh = await db.tradingSystem.findFirstOrThrow({
      where: { id, userId },
      include: { items: true },
    });
    return NextResponse.json(serializeTradingSystem(fresh));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Cập nhật thất bại";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Soft-delete via `archived = true`. Hard delete is avoided because trades
 * may still reference the system; the FK is `onDelete: SetNull` so hard
 * delete would silently detach the relation. Archive keeps history clean.
 */
export async function DELETE(_req: Request, { params }: RouteCtx) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const existing = await db.tradingSystem.findFirst({
    where: { id, userId },
    select: { id: true, isDefault: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  await db.tradingSystem.update({
    where: { id },
    data: { archived: true, isDefault: false },
  });

  return NextResponse.json({ ok: true });
}
