import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/terms",
  // The usage guide is the page the launch post links to: a stranger has to be
  // able to read it — above all the read-only API-key explanation — BEFORE
  // deciding whether to sign in and hand over an exchange key.
  "/huong-dan",
  "/api/auth",
  "/api/register",
  // Public liveness probe for external uptime monitors — leaks nothing
  // sensitive (see src/app/api/health/route.ts).
  "/api/health",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Cookie name set by Auth.js for both http (dev) + https (prod).
  const sessionCookie =
    req.cookies.get("authjs.session-token")?.value ??
    req.cookies.get("__Secure-authjs.session-token")?.value;

  if (!sessionCookie) {
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("callbackUrl", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // run on everything except static assets, _next, favicon, public files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
