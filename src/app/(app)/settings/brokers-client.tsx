"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Loader2,
  Plug,
  PlugZap,
  Trash2,
  CircleCheck,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { EXCHANGE_LINKS, type Exchange } from "@/lib/brokers/referrals";
import { BrokerLogo } from "@/components/broker-logo";
import { cn } from "@/lib/utils";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * "Mở tài khoản [sàn]" CTA for users without an account yet — points at the
 * owner's referral link (see lib/brokers/referrals.ts). Shown in the
 * not-yet-connected state of each broker card.
 */
function RegisterCta({ exchange, label }: { exchange: Exchange; label: string }) {
  return (
    <a
      href={EXCHANGE_LINKS[exchange].register}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs transition-colors hover:bg-primary/10"
    >
      <span className="text-muted-foreground">
        Chưa có tài khoản {label}?{" "}
        <strong className="text-primary">Mở tài khoản</strong>
      </span>
      <ExternalLink className="size-3.5 shrink-0 text-primary" />
    </a>
  );
}

// ────────────────────────────────────────────────────────────────────
// Connection overview strip + collapsible connect section
// ────────────────────────────────────────────────────────────────────

const SUMMARY_BROKERS = [
  { key: "BITGET" as const, name: "Bitget", endpoint: "/api/brokers/bitget/keys" },
  { key: "BINANCE" as const, name: "Binance", endpoint: "/api/brokers/binance/keys" },
  { key: "MEXC" as const, name: "MEXC", endpoint: "/api/brokers/mexc/keys" },
  { key: "OKX" as const, name: "OKX", endpoint: "/api/brokers/okx/keys" },
];

/**
 * At-a-glance strip of which exchanges are linked — sits atop the broker grid
 * so the connection state is obvious without scrolling the cards. Reads each
 * broker's /keys status (light, DB-backed) in parallel. Read-only.
 */
export function BrokerConnectionSummary() {
  const [state, setState] = React.useState<Record<string, boolean> | null>(
    null,
  );

  React.useEffect(() => {
    let alive = true;
    Promise.all(
      SUMMARY_BROKERS.map((b) =>
        fetch(b.endpoint)
          .then((r) => (r.ok ? r.json() : null))
          .then(
            (d: { connected?: boolean } | null) =>
              [b.key, Boolean(d?.connected)] as const,
          )
          .catch(() => [b.key, false] as const),
      ),
    ).then((entries) => {
      if (alive) setState(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, []);

  const connectedCount = state
    ? Object.values(state).filter(Boolean).length
    : 0;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/40 px-4 py-3">
      <span className="mr-1 text-sm text-muted-foreground">
        {state === null
          ? "Đang kiểm tra kết nối…"
          : connectedCount === 0
            ? "Chưa kết nối sàn nào — chọn một sàn bên dưới để bắt đầu."
            : `Đã kết nối ${connectedCount}/4 sàn`}
      </span>
      {SUMMARY_BROKERS.map((b) => {
        const connected = Boolean(state?.[b.key]);
        return (
          <span
            key={b.key}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs transition-colors",
              connected
                ? "bg-bullish/10 text-bullish"
                : "border border-dashed text-muted-foreground",
            )}
          >
            <BrokerLogo broker={b.key} className="size-4 shrink-0" />
            {b.name}
            {connected ? <CircleCheck className="size-3" /> : null}
          </span>
        );
      })}
      {connectedCount > 0 ? (
        <Link
          href="/"
          className="ml-auto text-xs font-medium text-primary hover:underline"
        >
          Xem Tổng tài sản →
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Collapsible "connect via API key" section for a not-yet-connected broker.
 * The referral CTA stays visible above it; the guide + key form hide behind
 * one button so four un-linked cards don't stack into a wall. Opens straight
 * away when the user is re-entering a key (editing an existing connection).
 */
function ConnectSection({
  defaultOpen = false,
  children,
}: {
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plug className="size-4" />
        Kết nối bằng API key
      </Button>
    );
  }
  return (
    <div className="space-y-4">
      {children}
      {!defaultOpen ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Thu gọn
        </button>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Bitget card
// ────────────────────────────────────────────────────────────────────

type BitgetStatus = {
  connected: boolean;
  meta: {
    uid?: string;
    apiKeyMasked?: string;
    savedAt?: string;
  } | null;
};

type BitgetAccount = {
  balance: {
    marginCoin: string;
    equity: number | null;
    available: number | null;
    used: number | null;
    unrealizedPnl: number | null;
  };
  positions: Array<{
    symbol: string;
    side: "long" | "short";
    size: number | null;
    leverage: number | null;
    unrealizedPnl: number | null;
  }>;
};

const fmtNum = (n: number | null | undefined, d = 2): string =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(d) : "—";

export function BitgetBrokerCard() {
  const [status, setStatus] = React.useState<BitgetStatus | null>(null);
  const [account, setAccount] = React.useState<BitgetAccount | null>(null);
  const [accountError, setAccountError] = React.useState<string | null>(null);
  const [accountLoading, setAccountLoading] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [passphrase, setPassphrase] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  // Load saved state on mount.
  React.useEffect(() => {
    fetch("/api/brokers/bitget/keys")
      .then((r) => r.json())
      .then((d: BitgetStatus) => setStatus(d))
      .catch(() => setStatus({ connected: false, meta: null }));
  }, []);

  // Fetch balance + positions whenever the card is in the "connected"
  // state. Refresh button below also reuses this.
  const refreshAccount = React.useCallback(async () => {
    setAccountLoading(true);
    setAccountError(null);
    try {
      const res = await fetch("/api/brokers/bitget/account");
      const j = await res.json();
      if (!res.ok) {
        setAccountError(j?.error ?? `Lỗi ${res.status}`);
        setAccount(null);
        return;
      }
      setAccount(j as BitgetAccount);
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setAccountLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (status?.connected && !editing) {
      refreshAccount();
    } else {
      setAccount(null);
      setAccountError(null);
    }
  }, [status?.connected, editing, refreshAccount]);

  const save = async () => {
    if (!apiKey || !secret || !passphrase) {
      toast.error("Cần nhập đủ 3 trường: API key, Secret, Passphrase.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/bitget/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, secret, passphrase }),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        uid?: string;
        apiKeyMasked?: string;
        error?: string;
      };
      if (!res.ok || !d.ok) {
        toast.error(d.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success(`Đã kết nối Bitget — UID ${d.uid}`);
      // Wipe input values from React state ASAP (defense vs DevTools).
      setApiKey("");
      setSecret("");
      setPassphrase("");
      setEditing(false);
      // Refresh status.
      const next = await fetch("/api/brokers/bitget/keys").then((r) =>
        r.json(),
      );
      setStatus(next as BitgetStatus);
    } finally {
      setSubmitting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Gỡ kết nối Bitget khỏi app này?")) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/bitget/keys", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Không gỡ được kết nối.");
        return;
      }
      toast.success("Đã gỡ kết nối Bitget.");
      setStatus({ connected: false, meta: null });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BrokerLogo broker="BITGET" className="size-5 shrink-0" />
              Bitget
            </CardTitle>
            <CardDescription>
              USDT-M futures. Đọc số dư + vị thế (chỉ đọc) cho Tổng tài
              sản; bấm “Đồng bộ sàn” ở Nhật ký để nhập vị thế đang mở.
            </CardDescription>
          </div>
          {status?.connected ? (
            <Badge
              variant="outline"
              className="border-bullish/40 bg-bullish/10 text-bullish"
            >
              <CircleCheck className="size-3" />
              Đã kết nối
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.connected && !editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">UID Bitget</span>
                <span className="font-mono">{status.meta?.uid ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">API key</span>
                <span className="font-mono text-xs">
                  {status.meta?.apiKeyMasked ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lưu lúc</span>
                <span className="text-xs">
                  {status.meta?.savedAt
                    ? new Date(status.meta.savedAt).toLocaleString("vi-VN")
                    : "—"}
                </span>
              </div>
            </div>


            {/* Balance + positions block */}
            <div className="space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Số dư USDT-Futures</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={refreshAccount}
                  disabled={accountLoading}
                >
                  {accountLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    "Làm mới"
                  )}
                </Button>
              </div>
              {accountError ? (
                <p className="text-xs text-rose-500">{accountError}</p>
              ) : account ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Khả dụng</span>
                    <span className="font-mono">
                      {fmtNum(account.balance.available)} {account.balance.marginCoin}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Equity</span>
                    <span className="font-mono">
                      {fmtNum(account.balance.equity)} {account.balance.marginCoin}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PnL chưa chốt</span>
                    <span
                      className={`font-mono ${
                        ((account.balance.unrealizedPnl ?? 0) ?? 0) > 0
                          ? "text-bullish"
                          : ((account.balance.unrealizedPnl ?? 0) ?? 0) < 0
                            ? "text-bearish"
                            : ""
                      }`}
                    >
                      {((account.balance.unrealizedPnl ?? 0) ?? 0) >= 0 ? "+" : ""}
                      {fmtNum((account.balance.unrealizedPnl ?? 0))} {account.balance.marginCoin}
                    </span>
                  </div>
                  {account.positions.length > 0 ? (
                    <div className="mt-2 border-t pt-2">
                      <p className="mb-1 text-xs text-muted-foreground">
                        Vị thế đang mở ({account.positions.length})
                      </p>
                      <ul className="space-y-1">
                        {account.positions.map((p) => (
                          <li
                            key={`${p.symbol}-${p.side}`}
                            className="flex justify-between text-xs"
                          >
                            <span className="font-mono">
                              {p.symbol}{" "}
                              <Badge
                                variant={p.side === "long" ? "default" : "destructive"}
                                className="ml-1 text-[10px]"
                              >
                                {p.side.toUpperCase()} {p.leverage ?? "?"}x
                              </Badge>
                            </span>
                            <span
                              className={`font-mono ${
                                (p.unrealizedPnl ?? 0) > 0
                                  ? "text-bullish"
                                  : (p.unrealizedPnl ?? 0) < 0
                                    ? "text-bearish"
                                    : ""
                              }`}
                            >
                              {(p.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
                              {fmtNum(p.unrealizedPnl)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Chưa có vị thế nào đang mở.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {accountLoading ? "Đang tải…" : "—"}
                </p>
              )}
            </div>

            <SpotMiniBlock broker="BITGET" />

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                Đổi key
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={disconnect}
                disabled={submitting}
              >
                <Trash2 className="size-4" />
                Gỡ kết nối
              </Button>
            </div>
          </div>
        ) : (
          <>
            {!editing ? <RegisterCta exchange="BITGET" label="Bitget" /> : null}
            <ConnectSection defaultOpen={editing}>
            <BitgetGuide />
            <Separator />
            <div className="space-y-3">
              <FormField label="API Key" hint="Bắt đầu bằng bg_">
                <Input
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="bg_xxxxxxxxxxxxxxxxxxxxx"
                />
              </FormField>
              <FormField label="Secret Key">
                <div className="relative">
                  <Input
                    autoComplete="off"
                    type={showSecret ? "text" : "password"}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="64+ ký tự từ Bitget"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showSecret ? "Ẩn secret" : "Hiện secret"}
                  >
                    {showSecret ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </FormField>
              <FormField label="Passphrase" hint="Chuỗi bạn tự đặt khi tạo key">
                <Input
                  autoComplete="off"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="8-32 ký tự"
                />
              </FormField>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
                Kết nối & lưu
              </Button>
              {editing ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setApiKey("");
                    setSecret("");
                    setPassphrase("");
                  }}
                >
                  Huỷ
                </Button>
              ) : null}
            </div>
            </ConnectSection>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type SpotMini = {
  totalUsd: number;
  assets: Array<{ coin: string; total: number; usdValue: number }>;
  otherCount: number;
  otherUsd: number;
  dustCount: number;
  unpricedCount: number;
  error?: string;
};

/**
 * Compact spot-wallet block for the broker cards — same data the dashboard
 * hub shows, served from the portfolio endpoint's 60s cache (no extra
 * exchange calls). Read-only.
 */
function SpotMiniBlock({
  broker,
}: {
  broker: "BITGET" | "BINANCE" | "MEXC" | "OKX";
}) {
  // undefined = loading, null = not available (request failed)
  const [spot, setSpot] = React.useState<SpotMini | null | undefined>(
    undefined,
  );

  React.useEffect(() => {
    fetch("/api/brokers/portfolio")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: {
          brokers?: Array<{ broker: string; spot: SpotMini }>;
        } | null) => {
          const row = d?.brokers?.find((b) => b.broker === broker);
          setSpot(row ? row.spot : null);
        },
      )
      .catch(() => setSpot(null));
  }, [broker]);

  const fmtUsd = (n: number) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className="space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">Số dư Spot</span>
        {spot && !spot.error ? (
          <span className="font-mono text-xs">≈ {fmtUsd(spot.totalUsd)} USDT</span>
        ) : null}
      </div>
      {spot === undefined ? (
        <p className="text-xs text-muted-foreground">Đang tải…</p>
      ) : spot === null ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : spot.error ? (
        <p className="text-xs text-muted-foreground">{spot.error}</p>
      ) : spot.assets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {spot.dustCount + spot.unpricedCount > 0
            ? `Không có coin ≥ $1 (${spot.dustCount} bụi, ${spot.unpricedCount} không định giá được).`
            : "Ví spot trống."}
        </p>
      ) : (
        <div className="space-y-0.5">
          {spot.assets.map((a) => (
            <div key={a.coin} className="flex justify-between text-xs">
              <span className="font-mono">{a.coin}</span>
              <span className="font-mono text-muted-foreground">
                {a.total.toLocaleString("en-US", { maximumFractionDigits: 6 })}{" "}
                · ≈ {fmtUsd(a.usdValue)}
              </span>
            </div>
          ))}
          {spot.otherCount > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              + {spot.otherCount} coin khác ≈ {fmtUsd(spot.otherUsd)}
            </p>
          ) : null}
          {spot.dustCount > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              + {spot.dustCount} coin bụi &lt; $1 (đã ẩn)
            </p>
          ) : null}
          {spot.unpricedCount > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              + {spot.unpricedCount} coin không định giá được (thiếu cặp USDT)
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function BitgetGuide() {
  return (
    <details className="rounded-md border bg-card/40 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">
        Cách lấy 3 trường này trên Bitget
      </summary>
      <ol className="ml-4 mt-2 list-decimal space-y-1 text-muted-foreground">
        <li>
          Vào{" "}
          <a
            href={EXCHANGE_LINKS.BITGET.apiKey}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Bitget API Management
          </a>
          .
        </li>
        <li>
          Bấm <strong>Create API</strong> → chọn <em>System-generated</em>.
        </li>
        <li>
          Đặt <strong>Passphrase</strong> bạn tự gõ (8-32 ký tự — phải nhớ vì
          sàn không hiện lại).
        </li>
        <li>
          Permissions: chỉ cần quyền <strong>ĐỌC</strong> (Futures → Orders +
          Holdings) — đủ để app đọc số dư/vị thế và nhập vị thế đang mở vào nhật
          ký. KHÔNG tick <strong>Trade/Transfer/Withdraw</strong> — app
          chỉ đọc, không bao giờ đặt lệnh hộ bạn.
        </li>
        <li>
          Ô <strong>IP whitelist</strong>: để trống (không bắt buộc).
        </li>
        <li>
          Submit → copy <strong>API Key</strong> + <strong>Secret Key</strong>{" "}
          (chỉ hiện 1 lần) + nhớ <strong>Passphrase</strong> bạn vừa đặt.
        </li>
      </ol>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────
// MetaApi (Exness MT4/MT5) card
// ────────────────────────────────────────────────────────────────────

type MetaApiStatus = {
  connected: boolean;
  meta: {
    accountId?: string;
    server?: string;
    platform?: string;
    loginLast4?: string;
    tokenMasked?: string;
    savedAt?: string;
  } | null;
};

export function MetaApiBrokerCard() {
  const [status, setStatus] = React.useState<MetaApiStatus | null>(null);
  const [token, setToken] = React.useState("");
  const [login, setLogin] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [server, setServer] = React.useState("");
  const [platform, setPlatform] = React.useState<"mt4" | "mt5">("mt5");
  const [showSecret, setShowSecret] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/brokers/metaapi/keys")
      .then((r) => r.json())
      .then((d: MetaApiStatus) => setStatus(d))
      .catch(() => setStatus({ connected: false, meta: null }));
  }, []);

  const save = async () => {
    if (!token || !login || !password || !server) {
      toast.error("Cần nhập đủ 4 trường: Token, Login, Password, Server.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/metaapi/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, login, password, server, platform }),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        accountId?: string;
        error?: string;
      };
      if (!res.ok || !d.ok) {
        toast.error(d.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success(`Đã kết nối MetaApi — account ${d.accountId?.slice(0, 8)}`);
      setToken("");
      setLogin("");
      setPassword("");
      setServer("");
      setEditing(false);
      const next = await fetch("/api/brokers/metaapi/keys").then((r) =>
        r.json(),
      );
      setStatus(next as MetaApiStatus);
    } finally {
      setSubmitting(false);
    }
  };

  const disconnect = async () => {
    if (
      !confirm(
        "Gỡ kết nối MetaApi? Account MT trên MetaApi cũng sẽ bị xoá.",
      )
    )
      return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/metaapi/keys", {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Không gỡ được kết nối.");
        return;
      }
      toast.success("Đã gỡ kết nối MetaApi.");
      setStatus({ connected: false, meta: null });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <PlugZap className="size-4 text-primary" />
              Exness / MT4 · MT5 (qua MetaApi)
            </CardTitle>
            <CardDescription>
              Bridge cloud — kết nối MT4/MT5 broker. Phase 1 chỉ đọc balance &
              vị thế. Login/password gửi MetaApi 1 lần lúc provision rồi xoá
              khỏi app này.
            </CardDescription>
          </div>
          {status?.connected ? (
            <Badge
              variant="outline"
              className="border-bullish/40 bg-bullish/10 text-bullish"
            >
              <CircleCheck className="size-3" />
              Đã kết nối
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.connected && !editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Account ID</span>
                <span className="font-mono text-xs">
                  {status.meta?.accountId ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Server</span>
                <span className="font-mono text-xs">
                  {status.meta?.server ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Platform</span>
                <span className="font-mono text-xs">
                  {(status.meta?.platform ?? "—").toString().toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">MT login</span>
                <span className="font-mono text-xs">
                  •••{status.meta?.loginLast4 ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Token</span>
                <span className="font-mono text-xs">
                  {status.meta?.tokenMasked ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lưu lúc</span>
                <span className="text-xs">
                  {status.meta?.savedAt
                    ? new Date(status.meta.savedAt).toLocaleString("vi-VN")
                    : "—"}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                Đổi kết nối
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={disconnect}
                disabled={submitting}
              >
                <Trash2 className="size-4" />
                Gỡ kết nối
              </Button>
            </div>
          </div>
        ) : (
          <>
            <MetaApiGuide />
            <Separator />
            <div className="space-y-3">
              <FormField label="MetaApi Token" hint="Lấy từ dashboard metaapi.cloud">
                <div className="relative">
                  <Input
                    autoComplete="off"
                    type={showSecret ? "text" : "password"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="eyJhbGciOiJSUzI1NiIs..."
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showSecret ? "Ẩn token" : "Hiện token"}
                  >
                    {showSecret ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="MT login" hint="Số tài khoản">
                  <Input
                    autoComplete="off"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder="12345678"
                  />
                </FormField>
                <FormField label="Platform">
                  <Select
                    value={platform}
                    onValueChange={(v) => v && setPlatform(v as "mt4" | "mt5")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mt5">MT5</SelectItem>
                      <SelectItem value="mt4">MT4</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
              <FormField
                label="MT password"
                hint="Master/trading password (KHÔNG dùng investor password để Phase 2 đặt lệnh được). Chỉ gửi MetaApi 1 lần, không lưu ở app."
              >
                <Input
                  autoComplete="off"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="MT4/MT5 password"
                />
              </FormField>
              <FormField
                label="Server"
                hint="Trong MT4/MT5: File → Login → server dropdown (vd Exness-MT5Real6)"
              >
                <Input
                  autoComplete="off"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="Exness-MT5Real6"
                />
              </FormField>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
                Kết nối & lưu
              </Button>
              {editing ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setToken("");
                    setLogin("");
                    setPassword("");
                    setServer("");
                  }}
                >
                  Huỷ
                </Button>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lưu ý: provision lần đầu mất 30-60 giây vì MetaApi phải khởi tạo
              MT terminal trên cloud.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MetaApiGuide() {
  return (
    <details className="rounded-md border bg-card/40 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">
        Cách lấy MetaApi token + setup Exness
      </summary>
      <ol className="ml-4 mt-2 list-decimal space-y-1 text-muted-foreground">
        <li>
          Đăng ký free trial tại{" "}
          <a
            href="https://app.metaapi.cloud/sign-up"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            metaapi.cloud
          </a>
          .
        </li>
        <li>
          Vào <strong>API access tokens</strong> → bấm <em>Generate token</em> →
          chọn scope <strong>account</strong>. Copy chuỗi JWT dài.
        </li>
        <li>
          Trong MT4/MT5 Exness: <strong>File → Login</strong> để xem{" "}
          <em>server</em> (vd <code>Exness-MT5Real6</code>) +{" "}
          <em>login number</em>.
        </li>
        <li>
          Dùng <strong>master password</strong> (không phải investor password)
          để Phase 2 có thể đặt lệnh được. Phase 1 read-only thì investor cũng
          OK.
        </li>
        <li>
          Paste 4 trường vào form bên dưới → bấm Kết nối. MetaApi sẽ
          provision MT terminal cloud (30-60s lần đầu).
        </li>
      </ol>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────
// Binance card — same flow as Bitget, two-field creds (no passphrase)
// ────────────────────────────────────────────────────────────────────

type BinanceStatus = {
  connected: boolean;
  meta: {
    apiKeyMasked?: string;
    savedAt?: string;
  } | null;
};

export function BinanceBrokerCard() {
  const [status, setStatus] = React.useState<BinanceStatus | null>(null);
  const [account, setAccount] = React.useState<BitgetAccount | null>(null);
  const [accountError, setAccountError] = React.useState<string | null>(null);
  const [accountLoading, setAccountLoading] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/brokers/binance/keys")
      .then((r) => r.json())
      .then((d: BinanceStatus) => setStatus(d))
      .catch(() => setStatus({ connected: false, meta: null }));
  }, []);

  const refreshAccount = React.useCallback(async () => {
    setAccountLoading(true);
    setAccountError(null);
    try {
      const res = await fetch("/api/brokers/binance/account");
      const j = await res.json();
      if (!res.ok) {
        setAccountError(j?.error ?? `Lỗi ${res.status}`);
        setAccount(null);
        return;
      }
      setAccount(j as BitgetAccount);
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setAccountLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (status?.connected && !editing) refreshAccount();
    else {
      setAccount(null);
      setAccountError(null);
    }
  }, [status?.connected, editing, refreshAccount]);

  const save = async () => {
    if (!apiKey || !secret) {
      toast.error("Cần nhập đủ API key và Secret.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/binance/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, secret }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        toast.error(d.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success("Đã kết nối Binance.");
      setApiKey("");
      setSecret("");
      setEditing(false);
      const next = await fetch("/api/brokers/binance/keys").then((r) => r.json());
      setStatus(next as BinanceStatus);
    } finally {
      setSubmitting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Gỡ kết nối Binance khỏi app này?")) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/binance/keys", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Không gỡ được kết nối.");
        return;
      }
      toast.success("Đã gỡ kết nối Binance.");
      setStatus({ connected: false, meta: null });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BrokerLogo broker="BINANCE" className="size-5 shrink-0" />
              Binance
            </CardTitle>
            <CardDescription>
              USDT-M futures. Đọc số dư + vị thế (chỉ đọc) cho Tổng tài
              sản; bấm “Đồng bộ sàn” ở Nhật ký để nhập vị thế đang mở.
            </CardDescription>
          </div>
          {status?.connected ? (
            <Badge
              variant="outline"
              className="border-bullish/40 bg-bullish/10 text-bullish"
            >
              <CircleCheck className="size-3" />
              Đã kết nối
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.connected && !editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">API key</span>
                <span className="font-mono text-xs">
                  {status.meta?.apiKeyMasked ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lưu lúc</span>
                <span className="text-xs">
                  {status.meta?.savedAt
                    ? new Date(status.meta.savedAt).toLocaleString("vi-VN")
                    : "—"}
                </span>
              </div>
            </div>

            <div className="space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Số dư USDT-M Futures</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={refreshAccount}
                  disabled={accountLoading}
                >
                  {accountLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    "Làm mới"
                  )}
                </Button>
              </div>
              {accountError ? (
                <p className="text-xs text-rose-500">{accountError}</p>
              ) : account ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Khả dụng</span>
                    <span className="font-mono">
                      {fmtNum(account.balance.available)} USDT
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Equity</span>
                    <span className="font-mono">
                      {fmtNum(account.balance.equity)} USDT
                    </span>
                  </div>
                  {account.positions.length > 0 ? (
                    <div className="mt-2 border-t pt-2">
                      <p className="mb-1 text-xs text-muted-foreground">
                        Vị thế đang mở ({account.positions.length})
                      </p>
                      <ul className="space-y-1">
                        {account.positions.map((p) => (
                          <li
                            key={`${p.symbol}-${p.side}`}
                            className="flex justify-between text-xs"
                          >
                            <span className="font-mono">
                              {p.symbol}{" "}
                              <Badge
                                variant={p.side === "long" ? "default" : "destructive"}
                                className="ml-1 text-[10px]"
                              >
                                {p.side.toUpperCase()} {p.leverage ?? "?"}x
                              </Badge>
                            </span>
                            <span
                              className={`font-mono ${
                                (p.unrealizedPnl ?? 0) > 0
                                  ? "text-bullish"
                                  : (p.unrealizedPnl ?? 0) < 0
                                    ? "text-bearish"
                                    : ""
                              }`}
                            >
                              {(p.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
                              {fmtNum(p.unrealizedPnl)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Chưa có vị thế nào đang mở.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {accountLoading ? "Đang tải…" : "—"}
                </p>
              )}
            </div>

            <SpotMiniBlock broker="BINANCE" />

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Đổi key
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={disconnect}
                disabled={submitting}
              >
                <Trash2 className="size-4" />
                Gỡ kết nối
              </Button>
            </div>
          </div>
        ) : (
          <>
            {!editing ? (
              <RegisterCta exchange="BINANCE" label="Binance" />
            ) : null}
            <ConnectSection defaultOpen={editing}>
            <details className="rounded-md border bg-card/40 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                Cách lấy API key Binance
              </summary>
              <ol className="ml-4 mt-2 list-decimal space-y-1 text-muted-foreground">
                <li>
                  Vào{" "}
                  <a
                    href={EXCHANGE_LINKS.BINANCE.apiKey}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    Binance API Management
                  </a>{" "}
                  → Create API → System generated.
                </li>
                <li>
                  Permissions: chỉ cần tick <strong>Enable Reading</strong> —
                  đủ để đọc số dư/vị thế và nhập vị thế vào nhật ký. KHÔNG tick Enable
                  Futures/Withdraw — app chỉ đọc, không bao giờ đặt lệnh.
                </li>
                <li>
                  IP access: chọn <strong>Unrestricted</strong> — key chỉ đọc
                  không cần whitelist IP.
                </li>
                <li>
                  Copy <strong>API Key</strong> + <strong>Secret Key</strong>{" "}
                  (secret chỉ hiện 1 lần).
                </li>
                <li>
                  Tài khoản phải đã mở Futures (vào tab Futures kích hoạt 1 lần).
                </li>
              </ol>
            </details>
            <div className="space-y-3">
              <FormField label="API Key">
                <Input
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="64 ký tự từ Binance"
                />
              </FormField>
              <FormField label="Secret Key">
                <div className="relative">
                  <Input
                    autoComplete="off"
                    type={showSecret ? "text" : "password"}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="64 ký tự — chỉ hiện 1 lần khi tạo"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showSecret ? "Ẩn secret" : "Hiện secret"}
                  >
                    {showSecret ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </FormField>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
                Kết nối & lưu
              </Button>
              {editing ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setApiKey("");
                    setSecret("");
                  }}
                >
                  Huỷ
                </Button>
              ) : null}
            </div>
            </ConnectSection>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// MEXC card — Spot (always) + Futures (optional, needs Futures-enabled key)
// ────────────────────────────────────────────────────────────────────

type MexcStatus = {
  connected: boolean;
  meta: {
    apiKeyMasked?: string;
    savedAt?: string;
  } | null;
};

export function MexcBrokerCard() {
  const [status, setStatus] = React.useState<MexcStatus | null>(null);
  const [account, setAccount] = React.useState<BitgetAccount | null>(null);
  const [accountError, setAccountError] = React.useState<string | null>(null);
  const [accountLoading, setAccountLoading] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/brokers/mexc/keys")
      .then((r) => r.json())
      .then((d: MexcStatus) => setStatus(d))
      .catch(() => setStatus({ connected: false, meta: null }));
  }, []);

  const refreshAccount = React.useCallback(async () => {
    setAccountLoading(true);
    setAccountError(null);
    try {
      const res = await fetch("/api/brokers/mexc/account");
      const j = await res.json();
      if (!res.ok) {
        setAccountError(j?.error ?? `Lỗi ${res.status}`);
        setAccount(null);
        return;
      }
      setAccount(j as BitgetAccount);
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setAccountLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (status?.connected && !editing) refreshAccount();
    else {
      setAccount(null);
      setAccountError(null);
    }
  }, [status?.connected, editing, refreshAccount]);

  const save = async () => {
    if (!apiKey || !secret) {
      toast.error("Cần nhập đủ API key và Secret.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/mexc/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, secret }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        toast.error(d.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success("Đã kết nối MEXC.");
      setApiKey("");
      setSecret("");
      setEditing(false);
      const next = await fetch("/api/brokers/mexc/keys").then((r) => r.json());
      setStatus(next as MexcStatus);
    } finally {
      setSubmitting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Gỡ kết nối MEXC khỏi app này?")) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/mexc/keys", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Không gỡ được kết nối.");
        return;
      }
      toast.success("Đã gỡ kết nối MEXC.");
      setStatus({ connected: false, meta: null });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BrokerLogo broker="MEXC" className="size-5 shrink-0" />
              MEXC
            </CardTitle>
            <CardDescription>
              Đọc ví Spot (chỉ đọc). Nếu key có quyền Futures (cần KYC) thì đọc
              thêm ví + vị thế Futures. App không bao giờ đặt lệnh.
            </CardDescription>
          </div>
          {status?.connected ? (
            <Badge
              variant="outline"
              className="border-bullish/40 bg-bullish/10 text-bullish"
            >
              <CircleCheck className="size-3" />
              Đã kết nối
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.connected && !editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">API key</span>
                <span className="font-mono text-xs">
                  {status.meta?.apiKeyMasked ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lưu lúc</span>
                <span className="text-xs">
                  {status.meta?.savedAt
                    ? new Date(status.meta.savedAt).toLocaleString("vi-VN")
                    : "—"}
                </span>
              </div>
            </div>

            {/* Spot is the guaranteed capability — show it first. */}
            <SpotMiniBlock broker="MEXC" />

            {/* Futures is optional (needs a Futures-enabled key). A spot-only
                key errors here — render it softly, not as an alarm. */}
            <div className="space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Số dư Futures</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={refreshAccount}
                  disabled={accountLoading}
                >
                  {accountLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    "Làm mới"
                  )}
                </Button>
              </div>
              {accountError ? (
                <p className="text-xs text-muted-foreground">
                  Chưa đọc được Futures — bỏ qua nếu bạn chỉ dùng Spot. ({accountError})
                </p>
              ) : account ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Khả dụng</span>
                    <span className="font-mono">
                      {fmtNum(account.balance.available)} USDT
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Equity</span>
                    <span className="font-mono">
                      {fmtNum(account.balance.equity)} USDT
                    </span>
                  </div>
                  {account.positions.length > 0 ? (
                    <div className="mt-2 border-t pt-2">
                      <p className="mb-1 text-xs text-muted-foreground">
                        Vị thế đang mở ({account.positions.length})
                      </p>
                      <ul className="space-y-1">
                        {account.positions.map((p) => (
                          <li
                            key={`${p.symbol}-${p.side}`}
                            className="flex justify-between text-xs"
                          >
                            <span className="font-mono">
                              {p.symbol}{" "}
                              <Badge
                                variant={p.side === "long" ? "default" : "destructive"}
                                className="ml-1 text-[10px]"
                              >
                                {p.side.toUpperCase()} {p.leverage ?? "?"}x
                              </Badge>
                            </span>
                            <span
                              className={`font-mono ${
                                (p.unrealizedPnl ?? 0) > 0
                                  ? "text-bullish"
                                  : (p.unrealizedPnl ?? 0) < 0
                                    ? "text-bearish"
                                    : ""
                              }`}
                            >
                              {(p.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
                              {fmtNum(p.unrealizedPnl)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Chưa có vị thế nào đang mở.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {accountLoading ? "Đang tải…" : "—"}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Đổi key
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={disconnect}
                disabled={submitting}
              >
                <Trash2 className="size-4" />
                Gỡ kết nối
              </Button>
            </div>
          </div>
        ) : (
          <>
            {!editing ? <RegisterCta exchange="MEXC" label="MEXC" /> : null}
            <ConnectSection defaultOpen={editing}>
            <details className="rounded-md border bg-card/40 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                Cách lấy API key MEXC
              </summary>
              <ol className="ml-4 mt-2 list-decimal space-y-1 text-muted-foreground">
                <li>
                  Vào{" "}
                  <a
                    href={EXCHANGE_LINKS.MEXC.apiKey}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    MEXC API Management
                  </a>{" "}
                  → Create API.
                </li>
                <li>
                  Permissions: tick <strong>Read</strong> phần{" "}
                  <strong>Spot</strong> (và <strong>Futures</strong> nếu muốn
                  xem ví Futures). KHÔNG tick Trade/Withdraw — app chỉ đọc.
                </li>
                <li>
                  IP access: để <strong>trống / Unrestricted</strong> — key chỉ
                  đọc không cần whitelist IP.
                </li>
                <li>
                  Copy <strong>Access Key</strong> + <strong>Secret Key</strong>{" "}
                  (secret chỉ hiện 1 lần).
                </li>
              </ol>
            </details>
            <div className="space-y-3">
              <FormField label="API Key">
                <Input
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Access Key từ MEXC"
                />
              </FormField>
              <FormField label="Secret Key">
                <div className="relative">
                  <Input
                    autoComplete="off"
                    type={showSecret ? "text" : "password"}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="Secret Key — chỉ hiện 1 lần khi tạo"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showSecret ? "Ẩn secret" : "Hiện secret"}
                  >
                    {showSecret ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </FormField>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
                Kết nối & lưu
              </Button>
              {editing ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setApiKey("");
                    setSecret("");
                  }}
                >
                  Huỷ
                </Button>
              ) : null}
            </div>
            </ConnectSection>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// OKX card — unified account (spot + derivatives), 3 creds incl. passphrase
// ────────────────────────────────────────────────────────────────────

type OkxStatus = {
  connected: boolean;
  meta: { apiKeyMasked?: string; savedAt?: string } | null;
};

export function OkxBrokerCard() {
  const [status, setStatus] = React.useState<OkxStatus | null>(null);
  const [account, setAccount] = React.useState<BitgetAccount | null>(null);
  const [accountError, setAccountError] = React.useState<string | null>(null);
  const [accountLoading, setAccountLoading] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [passphrase, setPassphrase] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/brokers/okx/keys")
      .then((r) => r.json())
      .then((d: OkxStatus) => setStatus(d))
      .catch(() => setStatus({ connected: false, meta: null }));
  }, []);

  const refreshAccount = React.useCallback(async () => {
    setAccountLoading(true);
    setAccountError(null);
    try {
      const res = await fetch("/api/brokers/okx/account");
      const j = await res.json();
      if (!res.ok) {
        setAccountError(j?.error ?? `Lỗi ${res.status}`);
        setAccount(null);
        return;
      }
      setAccount(j as BitgetAccount);
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setAccountLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (status?.connected && !editing) refreshAccount();
    else {
      setAccount(null);
      setAccountError(null);
    }
  }, [status?.connected, editing, refreshAccount]);

  const save = async () => {
    if (!apiKey || !secret || !passphrase) {
      toast.error("Cần nhập đủ API key, Secret và Passphrase.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/okx/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, secret, passphrase }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        toast.error(d.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success("Đã kết nối OKX.");
      setApiKey("");
      setSecret("");
      setPassphrase("");
      setEditing(false);
      const next = await fetch("/api/brokers/okx/keys").then((r) => r.json());
      setStatus(next as OkxStatus);
    } finally {
      setSubmitting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Gỡ kết nối OKX khỏi app này?")) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/okx/keys", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Không gỡ được kết nối.");
        return;
      }
      toast.success("Đã gỡ kết nối OKX.");
      setStatus({ connected: false, meta: null });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BrokerLogo broker="OKX" className="size-5 shrink-0" />
              OKX
            </CardTitle>
            <CardDescription>
              Tài khoản OKX hợp nhất (spot + phái sinh dùng chung số dư). Đọc số
              dư + vị thế (chỉ đọc). App không bao giờ đặt lệnh.
            </CardDescription>
          </div>
          {status?.connected ? (
            <Badge
              variant="outline"
              className="border-bullish/40 bg-bullish/10 text-bullish"
            >
              <CircleCheck className="size-3" />
              Đã kết nối
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.connected && !editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">API key</span>
                <span className="font-mono text-xs">
                  {status.meta?.apiKeyMasked ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lưu lúc</span>
                <span className="text-xs">
                  {status.meta?.savedAt
                    ? new Date(status.meta.savedAt).toLocaleString("vi-VN")
                    : "—"}
                </span>
              </div>
            </div>

            <SpotMiniBlock broker="OKX" />

            {/* Unified account → no separate futures wallet; show open
                positions + their floating PnL only. */}
            <div className="space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Vị thế phái sinh</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={refreshAccount}
                  disabled={accountLoading}
                >
                  {accountLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    "Làm mới"
                  )}
                </Button>
              </div>
              {accountError ? (
                <p className="text-xs text-muted-foreground">
                  Chưa đọc được vị thế — bỏ qua nếu bạn chỉ giữ spot. ({accountError})
                </p>
              ) : account ? (
                account.positions.length > 0 ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Lãi/lỗ mở</span>
                      <span
                        className={`font-mono ${
                          (account.balance.unrealizedPnl ?? 0) > 0
                            ? "text-bullish"
                            : (account.balance.unrealizedPnl ?? 0) < 0
                              ? "text-bearish"
                              : ""
                        }`}
                      >
                        {(account.balance.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
                        {fmtNum((account.balance.unrealizedPnl ?? 0))} USD
                      </span>
                    </div>
                    <ul className="mt-1 space-y-1 border-t pt-2">
                      {account.positions.map((p) => (
                        <li
                          key={`${p.symbol}-${p.side}`}
                          className="flex justify-between text-xs"
                        >
                          <span className="font-mono">
                            {p.symbol}{" "}
                            <Badge
                              variant={p.side === "long" ? "default" : "destructive"}
                              className="ml-1 text-[10px]"
                            >
                              {p.side.toUpperCase()} {p.leverage ?? "?"}x
                            </Badge>
                          </span>
                          <span
                            className={`font-mono ${
                              (p.unrealizedPnl ?? 0) > 0
                                ? "text-bullish"
                                : (p.unrealizedPnl ?? 0) < 0
                                  ? "text-bearish"
                                  : ""
                            }`}
                          >
                            {(p.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
                            {fmtNum(p.unrealizedPnl)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Chưa có vị thế phái sinh nào đang mở.
                  </p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  {accountLoading ? "Đang tải…" : "—"}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Đổi key
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={disconnect}
                disabled={submitting}
              >
                <Trash2 className="size-4" />
                Gỡ kết nối
              </Button>
            </div>
          </div>
        ) : (
          <>
            {!editing ? <RegisterCta exchange="OKX" label="OKX" /> : null}
            <ConnectSection defaultOpen={editing}>
            <details className="rounded-md border bg-card/40 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                Cách lấy API key OKX
              </summary>
              <ol className="ml-4 mt-2 list-decimal space-y-1 text-muted-foreground">
                <li>
                  Vào{" "}
                  <a
                    href={EXCHANGE_LINKS.OKX.apiKey}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    OKX API Management
                  </a>{" "}
                  → Create API key.
                </li>
                <li>
                  Permissions: chỉ tick <strong>Read</strong>. KHÔNG tick
                  Trade/Withdraw — app chỉ đọc.
                </li>
                <li>
                  Tự đặt <strong>Passphrase</strong> (bạn tự gõ khi tạo key —
                  phải nhớ vì OKX không hiện lại).
                </li>
                <li>
                  IP: để trống (Unrestricted) — key chỉ đọc không cần whitelist.
                </li>
                <li>
                  Copy <strong>API Key</strong> + <strong>Secret Key</strong> +{" "}
                  <strong>Passphrase</strong>.
                </li>
              </ol>
            </details>
            <div className="space-y-3">
              <FormField label="API Key">
                <Input
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="API Key từ OKX"
                />
              </FormField>
              <FormField label="Secret Key">
                <div className="relative">
                  <Input
                    autoComplete="off"
                    type={showSecret ? "text" : "password"}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="Secret Key — chỉ hiện 1 lần khi tạo"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showSecret ? "Ẩn secret" : "Hiện secret"}
                  >
                    {showSecret ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </FormField>
              <FormField label="Passphrase" hint="Bạn tự đặt khi tạo API key">
                <Input
                  autoComplete="off"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Passphrase của API key"
                />
              </FormField>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
                Kết nối & lưu
              </Button>
              {editing ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setApiKey("");
                    setSecret("");
                    setPassphrase("");
                  }}
                >
                  Huỷ
                </Button>
              ) : null}
            </div>
            </ConnectSection>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// Telegram notify card (system bot, one-tap link)
// ────────────────────────────────────────────────────────────────────

type TgStatus = { enabled: boolean; connected: boolean };

export function TelegramNotifyCard() {
  const [status, setStatus] = React.useState<TgStatus | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const s = (await fetch("/api/notify/telegram").then((r) =>
        r.json(),
      )) as TgStatus;
      setStatus(s);
      return s;
    } catch {
      setStatus({ enabled: false, connected: false });
      return null;
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [refresh]);

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/notify/telegram", { method: "POST" });
      const d = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!res.ok || !d?.url) {
        toast.error(d?.error ?? `Lỗi ${res.status}`);
        setConnecting(false);
        return;
      }
      // Open Telegram; the user presses Start there, the bot's long-poll
      // loop binds their chat, then our status flips to connected.
      window.open(d.url, "_blank", "noopener");
      toast.info("Bấm Start trong Telegram để hoàn tất kết nối…");

      const startedAt = Date.now();
      const poll = async () => {
        const s = await refresh();
        if (s?.connected) {
          setConnecting(false);
          toast.success("Đã kết nối Telegram! 🎉");
          return;
        }
        if (Date.now() - startedAt > 3 * 60_000) {
          setConnecting(false);
          return; // give up quietly after 3 min
        }
        pollTimer.current = setTimeout(poll, 2500);
      };
      pollTimer.current = setTimeout(poll, 2500);
    } catch {
      toast.error("Không tạo được liên kết. Thử lại.");
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Ngắt thông báo Telegram?")) return;
    try {
      const res = await fetch("/api/notify/telegram", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Không ngắt được.");
        return;
      }
      toast.success("Đã ngắt Telegram.");
      setStatus({ enabled: true, connected: false });
    } catch {
      toast.error("Không ngắt được.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <PlugZap className="size-4 text-primary" />
              Thông báo Telegram
            </CardTitle>
            <CardDescription>
              Nhận cảnh báo <strong>tín hiệu đồng thuận</strong> cho các coin
              trong watchlist của bạn — bấm Start một lần là xong. Chọn coin,
              khung &amp; hướng báo ở trang Quét đa khung → panel Watchlist.
            </CardDescription>
          </div>
          {status?.connected ? (
            <Badge
              variant="outline"
              className="border-bullish/40 bg-bullish/10 text-bullish"
            >
              <CircleCheck className="size-3" />
              Đã kết nối
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === null ? (
          <p className="text-xs text-muted-foreground">Đang tải…</p>
        ) : !status.enabled ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Kênh Telegram chưa được bật trên hệ thống. Vui lòng thử lại sau.
          </p>
        ) : status.connected ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-sm text-muted-foreground">
              Bạn đang nhận thông báo qua bot Nhật Ký Trade. Muốn dừng thì gõ{" "}
              <code className="rounded bg-muted px-1">/stop</code> trong
              Telegram, hoặc:
            </p>
            <Button variant="destructive" size="sm" onClick={disconnect}>
              <Trash2 className="size-4" />
              Ngắt kết nối
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Bấm nút bên dưới → Telegram mở ra → bấm{" "}
              <strong>Start</strong> là xong.
            </p>
            <Button onClick={connect} disabled={connecting}>
              {connecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plug className="size-4" />
              )}
              {connecting ? "Đang chờ bạn bấm Start…" : "Kết nối Telegram"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// Change password card (Tài khoản tab)
// ────────────────────────────────────────────────────────────────────

export function ChangePasswordCard() {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async () => {
    if (next !== confirm) {
      toast.error("Mật khẩu mới nhập lại không khớp.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d?.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success("Đã đổi mật khẩu.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Đổi mật khẩu</CardTitle>
        <CardDescription>
          Cần mật khẩu hiện tại để xác nhận. Mật khẩu mới tối thiểu 8 ký tự,
          gồm chữ và số.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormField label="Mật khẩu hiện tại">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Mật khẩu mới">
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </FormField>
          <FormField label="Nhập lại mật khẩu mới">
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </FormField>
        </div>
        <Button
          size="sm"
          onClick={submit}
          disabled={submitting || !current || !next || !confirm}
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Đổi mật khẩu
        </Button>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// Small reusable field wrapper
// ────────────────────────────────────────────────────────────────────

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
