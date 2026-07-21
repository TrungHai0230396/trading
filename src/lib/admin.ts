/**
 * Admin gating.
 *
 * The admin area (stats + health monitoring) is owner-only. Access is decided
 * by an email allowlist in `ADMIN_EMAILS` (comma-separated). Env-only —
 * cannot be self-granted from any endpoint.
 */

import "server-only";

export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}
