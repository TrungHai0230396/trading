import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";

/**
 * Renders children inside the normal app shell when there IS a session, and
 * bare when there isn't.
 *
 * Public pages like /huong-dan live outside the (app) route group so a
 * stranger can read them before signing in — but that also stripped the
 * sidebar from a signed-in reader, dropping them out of the app with no
 * navigation. Duplicating the route inside (app) is impossible (same path), so
 * the shell becomes conditional instead.
 *
 * Mirrors (app)/layout.tsx, minus the redirect: here a missing session is a
 * normal case, not a reason to bounce anyone to /login.
 */
export async function OptionalAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) return <>{children}</>;

  return (
    <SidebarProvider>
      <AppSidebar isAdmin={isAdminEmail(session.user.email)} />
      <SidebarInset>
        <Topbar />
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
