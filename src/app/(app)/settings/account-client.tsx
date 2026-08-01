"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Google's 4-colour "G" — nominative use, inline (CSP-safe). */
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

/**
 * Account identity card for the Settings → "Tài khoản" tab. Shows who you're
 * signed in as (Google), when you joined, and a compact, copyable account id
 * for support — instead of a giant raw cuid dominating the page. Read-only.
 */
export function AccountCard({
  email,
  name,
  userId,
  joinedAt,
}: {
  email: string;
  name: string | null;
  userId: string;
  joinedAt: string | null;
}) {
  const [copied, setCopied] = React.useState(false);

  const emailPrefix = email.split("@")[0];
  const displayName = name && name !== emailPrefix ? name : null;
  const initial = (displayName ?? email).trim().charAt(0).toUpperCase();

  const joined = joinedAt
    ? new Date(joinedAt).toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

  const shortId =
    userId.length > 12
      ? `${userId.slice(0, 6)}…${userId.slice(-4)}`
      : userId;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      toast.success("Đã copy mã tài khoản");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Không copy được — hãy copy thủ công.");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        {/* Identity header */}
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">
              {displayName ?? email}
            </p>
            {displayName ? (
              <p className="truncate text-sm text-muted-foreground">{email}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Tài khoản cá nhân</p>
            )}
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
          <div className="bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Đăng nhập bằng</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
              <GoogleGlyph className="size-4" />
              Google
            </p>
          </div>
          <div className="bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Tham gia</p>
            <p className="mt-1 text-sm font-medium">{joined}</p>
          </div>
        </div>

        {/* Account id — compact + copyable, for support */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">Mã tài khoản</p>
            <p className="truncate font-mono text-xs">{shortId}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              Cung cấp mã này khi cần hỗ trợ.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyId}
            className="shrink-0"
          >
            {copied ? (
              <Check className="size-4 text-bullish" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? "Đã copy" : "Copy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
