import { db } from "@/lib/db";

/** Returns the tag ids for the given names, creating any that don't exist. */
export async function resolveTagIds(
  userId: string,
  names: string[],
): Promise<string[]> {
  const cleaned = Array.from(
    new Set(
      names
        .map((n) => n.trim())
        .filter((n) => n.length > 0 && n.length <= 40),
    ),
  );
  if (cleaned.length === 0) return [];

  const existing = await db.tag.findMany({
    where: { userId, name: { in: cleaned } },
    select: { id: true, name: true },
  });
  const have = new Set(existing.map((t) => t.name));
  const toCreate = cleaned.filter((n) => !have.has(n));

  const created = await Promise.all(
    toCreate.map((name) =>
      db.tag.create({ data: { userId, name }, select: { id: true } }),
    ),
  );

  return [...existing.map((t) => t.id), ...created.map((t) => t.id)];
}
