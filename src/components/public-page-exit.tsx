import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";

/**
 * Way out of a public page (/terms, /huong-dan).
 *
 * These pages live outside the (app) route group, so they render WITHOUT the
 * sidebar. A signed-in user who opens one has no navigation at all, and
 * /terms used to offer only "quay lại đăng ký" — which redirects to /login and
 * bounces an already-signed-in user around. Resolve the destination from the
 * session instead: back into the app if they have one, to sign-in if not.
 */
export async function PublicPageExit() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <Link
      href={signedIn ? "/" : "/login"}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
    >
      <ArrowLeft className="size-4" />
      {signedIn ? "Về ứng dụng" : "Đăng nhập"}
    </Link>
  );
}
