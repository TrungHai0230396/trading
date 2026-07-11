import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { googleEnabled, googleOnly, googleOnlyIntent } from "@/lib/auth";

// Evaluated per-request, not baked at build time — the Docker builder has
// no AUTH_GOOGLE_* env, so a static prerender would freeze the Google
// button as hidden forever.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  // Google-only intent with broken/missing OAuth creds must fail CLOSED:
  // a config error page, not a silent fallback to the password form the
  // operator explicitly turned off.
  if (googleOnlyIntent && !googleEnabled) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Đăng nhập tạm gián đoạn
        </h1>
        <p className="text-sm text-muted-foreground">
          Hệ thống đang cấu hình lại đăng nhập Google. Vui lòng quay lại sau
          ít phút.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Chào mừng trở lại</h1>
        <p className="text-sm text-muted-foreground">
          Đăng nhập vào bảng điều khiển giao dịch của bạn.
        </p>
      </div>
      <Suspense fallback={<div className="h-[260px]" />}>
        <LoginForm googleEnabled={googleEnabled} googleOnly={googleOnly} />
      </Suspense>
      {googleOnly ? (
        <p className="text-xs text-muted-foreground">
          Đăng nhập bằng Google — tài khoản tạo tự động lần đầu.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Lần đầu sử dụng?{" "}
          <Link
            href="/register"
            className="font-medium text-primary hover:underline"
          >
            Tạo tài khoản
          </Link>
        </p>
      )}
    </div>
  );
}
