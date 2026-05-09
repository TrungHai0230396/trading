import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const tags = await db.tag.findMany({
    where: { userId: session.user.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });

  return NextResponse.json({ items: tags });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(20).optional(),
});

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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  const userId = session.user.id;
  try {
    const tag = await db.tag.upsert({
      where: { userId_name: { userId, name: parsed.data.name } },
      update: parsed.data.color ? { color: parsed.data.color } : {},
      create: {
        userId,
        name: parsed.data.name,
        color: parsed.data.color ?? null,
      },
      select: { id: true, name: true, color: true },
    });
    return NextResponse.json(tag, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Tạo tag thất bại";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
