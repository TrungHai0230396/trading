/**
 * Thin wrappers around `encrypt` / `decrypt` for typed JSON payloads.
 * Brokers store multi-field credentials (apiKey + secret + passphrase
 * for Bitget; token + accountId for MetaApi) as one encrypted blob —
 * having these helpers avoids repeating `JSON.stringify` everywhere
 * and makes the type contract explicit.
 */

import "server-only";
import { encrypt, decrypt } from "./crypto";

export function encryptJson<T>(value: T): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}
