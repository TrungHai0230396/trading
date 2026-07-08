"use client";

/**
 * "Tiếp tục với Google" button + divider + implied-consent note.
 * Shared by the login and register forms; renders nothing when Google
 * OAuth isn't configured (the server page passes `enabled`).
 */

import * as React from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function GoogleLoginButton({
  enabled,
  callbackUrl = "/",
  standalone = false,
}: {
  enabled: boolean;
  callbackUrl?: string;
  /** When true this is the ONLY auth method — omit the "hoặc" divider. */
  standalone?: boolean;
}) {
  const [pending, setPending] = React.useState(false);
  if (!enabled) return null;

  return (
    <div className="space-y-3">
      {standalone ? null : (
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            hoặc
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={pending}
        onClick={() => {
          setPending(true);
          // Full-page OAuth redirect; NextAuth returns to callbackUrl.
          void signIn("google", { callbackUrl });
        }}
      >
        <GoogleIcon />
        {pending ? "Đang chuyển đến Google…" : "Tiếp tục với Google"}
      </Button>
      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        Tiếp tục với Google đồng nghĩa bạn đồng ý với{" "}
        <a
          href="/terms"
          target="_blank"
          className="font-medium text-primary hover:underline"
        >
          Điều khoản & Miễn trừ trách nhiệm
        </a>
        .
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}
