"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Gauge } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { BrandMark } from "@/components/brand-mark";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { NAV_GROUPS } from "@/lib/nav";

function isActiveHref(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const { data: session } = useSession();

  // On mobile the sidebar is a modal drawer sitting on top of the page: after
  // navigating it stays open with focus trapped, so every tap looks like the
  // app froze. Close it on click rather than on a pathname effect — tapping
  // the item of the page you are already on leaves the pathname unchanged but
  // still has to dismiss the drawer.
  const closeOnMobile = React.useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const initials =
    session?.user?.name?.slice(0, 2).toUpperCase() ??
    session?.user?.email?.slice(0, 2).toUpperCase() ??
    "TR";

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <Link
          href="/"
          onClick={closeOnMobile}
          className="flex items-center gap-2 px-2 py-2 transition-opacity hover:opacity-80"
        >
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <BrandMark className="size-5" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold tracking-tight">
              Nhật Ký Trade
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Bảng điều khiển giao dịch
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActiveHref(pathname, item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={
                          <Link href={item.href} onClick={closeOnMobile} />
                        }
                        isActive={active}
                        tooltip={item.label}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {isAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel>Quản trị</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/admin" onClick={closeOnMobile} />}
                    isActive={isActiveHref(pathname, "/admin")}
                    tooltip="Quản trị"
                  >
                    <Gauge />
                    <span>Quản trị</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        {/* Explicit logout — no hidden menu. The previous dropdown trigger
            (Menu.Trigger render→SidebarMenuButton composition) never opened
            on click, leaving users with NO way to sign out. A visible
            button is also simply better UX for this. */}
        <div className="flex items-center gap-2 rounded-md border bg-card/40 p-2">
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm font-medium">
              {session?.user?.name ?? session?.user?.email ?? "Trader"}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {session?.user?.email ?? ""}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => {
              // Confirm — the icon sits next to the user block and an
              // accidental tap would dump the user out mid-workflow.
              if (confirm("Đăng xuất khỏi Nhật Ký Trade?")) {
                void signOut({ callbackUrl: "/login" });
              }
            }}
            aria-label="Đăng xuất"
            title="Đăng xuất"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
