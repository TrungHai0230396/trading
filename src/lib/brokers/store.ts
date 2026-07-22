/**
 * Single source of truth for broker credential storage.
 *
 * Layout decisions:
 *   - Secrets live in `ApiKey.encrypted` as a JSON blob (encrypted with
 *     AES-256-GCM via lib/crypto). Unique key is (userId, kind, label).
 *     We use `label = null` for the "default" broker connection per
 *     kind — leaving label open for future "demo vs live" splits.
 *   - Non-secret display metadata (UID, account name, savedAt) lives
 *     in `AppSetting` under key `broker:<kind_lowercased>`. Lets the
 *     settings page render "Đã kết nối · UID 12345" without doing an
 *     AES decrypt on every page load.
 */

import "server-only";
import { db } from "@/lib/db";
import { encryptJson, decryptJson } from "@/lib/crypto-json";

// TELEGRAM rides the same encrypted-credentials rails as the brokers —
// a bot token is a secret exactly like an API key.
export type BrokerKind =
  | "BITGET"
  | "BINANCE"
  | "MEXC"
  | "METAAPI"
  | "TELEGRAM";

export async function saveCreds<T>(
  userId: string,
  kind: BrokerKind,
  creds: T,
): Promise<void> {
  const encrypted = encryptJson(creds);
  // Find any existing default-label row first to decide create vs update.
  // We can't use upsert with `label: null` cleanly because Prisma treats
  // null as "any" in unique-key matching on MySQL.
  const existing = await db.apiKey.findFirst({
    where: { userId, kind, label: null },
  });
  if (existing) {
    await db.apiKey.update({
      where: { id: existing.id },
      data: { encrypted, isActive: true },
    });
  } else {
    await db.apiKey.create({
      data: { userId, kind, label: null, encrypted, isActive: true },
    });
  }
}

export async function loadCreds<T>(
  userId: string,
  kind: BrokerKind,
): Promise<T | null> {
  const row = await db.apiKey.findFirst({
    where: { userId, kind, isActive: true, label: null },
  });
  if (!row) return null;
  return decryptJson<T>(row.encrypted);
}

export async function hasCreds(
  userId: string,
  kind: BrokerKind,
): Promise<boolean> {
  const row = await db.apiKey.findFirst({
    where: { userId, kind, isActive: true, label: null },
    select: { id: true },
  });
  return row !== null;
}

export async function deleteCreds(
  userId: string,
  kind: BrokerKind,
): Promise<void> {
  await db.apiKey.deleteMany({ where: { userId, kind, label: null } });
  await db.appSetting.deleteMany({
    where: { userId, key: `broker:${kind.toLowerCase()}` },
  });
}

export async function setBrokerMeta(
  userId: string,
  kind: BrokerKind,
  value: Record<string, unknown>,
): Promise<void> {
  await db.appSetting.upsert({
    where: { userId_key: { userId, key: `broker:${kind.toLowerCase()}` } },
    create: {
      userId,
      key: `broker:${kind.toLowerCase()}`,
      value: value as object,
    },
    update: { value: value as object },
  });
}

export async function getBrokerMeta(
  userId: string,
  kind: BrokerKind,
): Promise<Record<string, unknown> | null> {
  const row = await db.appSetting.findUnique({
    where: { userId_key: { userId, key: `broker:${kind.toLowerCase()}` } },
  });
  return (row?.value as Record<string, unknown>) ?? null;
}
