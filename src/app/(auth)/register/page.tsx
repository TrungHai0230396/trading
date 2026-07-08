import Link from "next/link";
import { RegisterForm } from "./register-form";
import { googleEnabled } from "@/lib/auth";

// Per-request render — see login/page.tsx (build-time env is empty).
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Tạo tài khoản
        </h1>
        <p className="text-sm text-muted-foreground">
          Miễn phí. Nhật ký giao dịch, tính khối lượng, quét đa khung và
          cảnh báo Telegram.
        </p>
      </div>
      <RegisterForm googleEnabled={googleEnabled} />
      <p className="text-xs text-muted-foreground">
        Đã có tài khoản?{" "}
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          Đăng nhập
        </Link>
      </p>
    </div>
  );
}
