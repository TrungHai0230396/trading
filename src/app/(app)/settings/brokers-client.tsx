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
} from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [posMode, setPosMode] = React.useState<
    "one_way_mode" | "hedge_mode" | "unknown" | null
  >(null);
  const [posModeLoading, setPosModeLoading] = React.useState(false);
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

  // Read current position mode (one-way vs hedge). Phase 2 only supports
  // one-way, so when posMode === "hedge_mode" we show a "Switch" button.
  const refreshPosMode = React.useCallback(async () => {
    try {
      const res = await fetch("/api/brokers/bitget/position-mode");
      const j = await res.json();
      if (res.ok && j?.mode) setPosMode(j.mode);
    } catch {
      /* swallow — non-blocking */
    }
  }, []);

  React.useEffect(() => {
    if (status?.connected && !editing) refreshPosMode();
    else setPosMode(null);
  }, [status?.connected, editing, refreshPosMode]);

  const switchToOneWay = async () => {
    if (
      !confirm(
        "Chuyển tài khoản Bitget Futures sang chế độ One-way?\n\n" +
          "Yêu cầu: KHÔNG có vị thế đang mở và KHÔNG có lệnh treo. " +
          "Bitget sẽ từ chối nếu không thoả mãn.",
      )
    )
      return;
    setPosModeLoading(true);
    try {
      const res = await fetch("/api/brokers/bitget/position-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "one_way_mode" }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j?.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success("Đã chuyển sang One-way.");
      setPosMode("one_way_mode");
    } finally {
      setPosModeLoading(false);
    }
  };

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
              <PlugZap className="size-4 text-primary" />
              Bitget Futures
            </CardTitle>
            <CardDescription>
              USDT-M futures. Đọc số dư + vị thế, và đặt lệnh thật tự động
              từ Nhật ký giao dịch khi bật toggle.
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

            {posMode === "hedge_mode" ? (
              <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className="font-medium text-warning">
                    Tài khoản đang ở chế độ Hedge
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  App chỉ hỗ trợ đặt lệnh tự động ở chế độ One-way (Một chiều).
                  Đổi sang One-way trước khi dùng tính năng &ldquo;Đặt lệnh thật
                  trên Bitget&rdquo;. Yêu cầu: không có vị thế đang mở và không
                  có lệnh treo.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={switchToOneWay}
                  disabled={posModeLoading}
                >
                  {posModeLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : null}
                  Chuyển sang One-way
                </Button>
              </div>
            ) : null}

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
                        (account.balance.unrealizedPnl ?? 0) > 0
                          ? "text-bullish"
                          : (account.balance.unrealizedPnl ?? 0) < 0
                            ? "text-bearish"
                            : ""
                      }`}
                    >
                      {(account.balance.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
                      {fmtNum(account.balance.unrealizedPnl)} {account.balance.marginCoin}
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
          </>
        )}
      </CardContent>
    </Card>
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
            href="https://www.bitget.com/account/newapi"
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
          Permissions: tick <strong>Read-only</strong> + <strong>Trade</strong>.
          KHÔNG tick <strong>Transfer</strong> hay <strong>Withdraw</strong>.
        </li>
        <li>
          Nếu app deploy public, set IP whitelist. Nếu local, để IP máy bạn.
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
// Risk limits card — enforced server-side at order placement
// ────────────────────────────────────────────────────────────────────

export function RiskLimitsCard() {
  const [maxRiskPct, setMaxRiskPct] = React.useState("");
  const [maxOpenPositions, setMaxOpenPositions] = React.useState("");
  const [loaded, setLoaded] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/brokers/risk-limits")
      .then((r) => r.json())
      .then((d: { limits?: { maxRiskPct: number; maxOpenPositions: number } }) => {
        if (d.limits) {
          setMaxRiskPct(String(d.limits.maxRiskPct));
          setMaxOpenPositions(String(d.limits.maxOpenPositions));
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = async () => {
    const pct = Number(maxRiskPct.replace(",", "."));
    const pos = Math.floor(Number(maxOpenPositions));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      toast.error("% rủi ro mỗi lệnh phải trong khoảng 0–100.");
      return;
    }
    if (!Number.isFinite(pos) || pos < 1 || pos > 50) {
      toast.error("Số vị thế tối đa phải từ 1 đến 50.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/brokers/risk-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxRiskPct: pct, maxOpenPositions: pos }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d?.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success("Đã lưu giới hạn rủi ro.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Giới hạn rủi ro</CardTitle>
        <CardDescription>
          Chặn server-side tại thời điểm đặt lệnh thật — kể cả khi nhập sai
          khối lượng, lệnh vượt giới hạn sẽ bị từ chối.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            label="Rủi ro tối đa mỗi lệnh (% vốn)"
            hint="Khoảng cách entry→SL × khối lượng so với equity futures. Mặc định 5%."
          >
            <Input
              inputMode="decimal"
              className="num"
              value={maxRiskPct}
              onChange={(e) => setMaxRiskPct(e.target.value)}
              placeholder="5"
              disabled={!loaded}
            />
          </FormField>
          <FormField
            label="Số vị thế mở tối đa"
            hint="Đếm mọi vị thế đang mở trên Bitget. Mặc định 3."
          >
            <Input
              inputMode="numeric"
              className="num"
              value={maxOpenPositions}
              onChange={(e) =>
                setMaxOpenPositions(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="3"
              disabled={!loaded}
            />
          </FormField>
        </div>
        <Button size="sm" onClick={save} disabled={submitting || !loaded}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Lưu giới hạn
        </Button>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// Telegram notifications card
// ────────────────────────────────────────────────────────────────────

type TelegramStatus = {
  connected: boolean;
  meta: {
    botName?: string;
    chatId?: string;
    tokenMasked?: string;
    savedAt?: string;
  } | null;
};

export function TelegramNotifyCard() {
  const [status, setStatus] = React.useState<TelegramStatus | null>(null);
  const [botToken, setBotToken] = React.useState("");
  const [chatId, setChatId] = React.useState("");
  const [showToken, setShowToken] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/notify/telegram")
      .then((r) => r.json())
      .then((d: TelegramStatus) => setStatus(d))
      .catch(() => setStatus({ connected: false, meta: null }));
  }, []);

  const save = async () => {
    if (!botToken || !chatId) {
      toast.error("Cần nhập Bot token và Chat ID.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/notify/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: botToken.trim(), chatId: chatId.trim() }),
      });
      const d = (await res.json()) as { ok?: boolean; botName?: string; error?: string };
      if (!res.ok || !d.ok) {
        toast.error(d.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success(`Đã kết nối Telegram — @${d.botName}. Kiểm tra tin nhắn thử trong app.`);
      setBotToken("");
      setChatId("");
      setEditing(false);
      const next = await fetch("/api/notify/telegram").then((r) => r.json());
      setStatus(next as TelegramStatus);
    } finally {
      setSubmitting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Ngắt thông báo Telegram?")) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/notify/telegram", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Không ngắt được.");
        return;
      }
      toast.success("Đã ngắt Telegram.");
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
              Thông báo Telegram
            </CardTitle>
            <CardDescription>
              Nhận tin khi lệnh khớp / đóng / huỷ, và khi coin trong watchlist
              đạt đồng thuận bullish cả 4 khung (1h · 4h · 1d · 1w).
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
                <span className="text-muted-foreground">Bot</span>
                <span className="font-mono">@{status.meta?.botName ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Chat ID</span>
                <span className="font-mono text-xs">{status.meta?.chatId ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Token</span>
                <span className="font-mono text-xs">{status.meta?.tokenMasked ?? "—"}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Đổi bot
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={disconnect}
                disabled={submitting}
              >
                <Trash2 className="size-4" />
                Ngắt kết nối
              </Button>
            </div>
          </div>
        ) : (
          <>
            <details className="rounded-md border bg-card/40 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                Cách tạo bot + lấy Chat ID (2 phút)
              </summary>
              <ol className="ml-4 mt-2 list-decimal space-y-1 text-muted-foreground">
                <li>
                  Mở Telegram, chat với <strong>@BotFather</strong> → gõ{" "}
                  <code className="rounded bg-muted px-1">/newbot</code> → đặt tên
                  → nhận <strong>Bot token</strong> (dạng{" "}
                  <code className="rounded bg-muted px-1">123456:ABC-DEF…</code>).
                </li>
                <li>
                  Bấm <strong>Start</strong> cho bot vừa tạo (bắt buộc — bot không
                  thể nhắn trước cho bạn).
                </li>
                <li>
                  Chat với <strong>@userinfobot</strong> → nó trả về{" "}
                  <strong>Chat ID</strong> của bạn (dạng số).
                </li>
                <li>Dán 2 giá trị vào dưới → Kết nối. App sẽ gửi tin thử ngay.</li>
              </ol>
            </details>
            <div className="space-y-3">
              <FormField label="Bot token" hint="Từ @BotFather">
                <div className="relative">
                  <Input
                    autoComplete="off"
                    type={showToken ? "text" : "password"}
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="123456789:AAF..."
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showToken ? "Ẩn token" : "Hiện token"}
                  >
                    {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </FormField>
              <FormField label="Chat ID" hint="Từ @userinfobot — dạng số">
                <Input
                  autoComplete="off"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="123456789"
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
                Kết nối & gửi tin thử
              </Button>
              {editing ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setBotToken("");
                    setChatId("");
                  }}
                >
                  Huỷ
                </Button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// Consensus alert config — timeframes, direction, on/off
// ────────────────────────────────────────────────────────────────────

const ALL_ALERT_TFS = ["15m", "1h", "4h", "1d", "3d", "1w", "1M"] as const;

type ConsensusConfigUI = {
  enabled: boolean;
  timeframes: string[];
  notifyBullish: boolean;
  notifyBearish: boolean;
};

export function ConsensusAlertCard() {
  const [config, setConfig] = React.useState<ConsensusConfigUI | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/notify/consensus-config")
      .then((r) => r.json())
      .then((d: { config?: ConsensusConfigUI }) => {
        if (d.config) setConfig(d.config);
      })
      .catch(() => {
        /* card stays in loading state; refresh to retry */
      });
  }, []);

  const toggleTf = (tf: string) => {
    setConfig((c) => {
      if (!c) return c;
      const has = c.timeframes.includes(tf);
      return {
        ...c,
        timeframes: has
          ? c.timeframes.filter((t) => t !== tf)
          : // Keep chronological order by re-filtering the master list.
            ALL_ALERT_TFS.filter(
              (t) => c.timeframes.includes(t) || t === tf,
            ),
      };
    });
  };

  const save = async () => {
    if (!config) return;
    if (config.timeframes.length < 2) {
      toast.error("Chọn ít nhất 2 khung — 1 khung thì không còn là “đồng thuận”.");
      return;
    }
    if (!config.notifyBullish && !config.notifyBearish) {
      toast.error("Bật ít nhất một hướng (Bullish hoặc Bearish).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/notify/consensus-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d?.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success(
        `Đã lưu: báo khi ${config.timeframes.join(" · ")} cùng ${[
          config.notifyBullish ? "BULLISH" : null,
          config.notifyBearish ? "BEARISH" : null,
        ]
          .filter(Boolean)
          .join(" hoặc ")}.`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Tín hiệu đồng thuận</CardTitle>
            <CardDescription>
              Quét coin trong watchlist (trang Phân tích AI) mỗi 15 phút. Khi
              TẤT CẢ các khung đã chọn cùng hướng → gửi Telegram. Chỉ báo lúc
              mới đạt đồng thuận, không spam lại.
            </CardDescription>
          </div>
          {config ? (
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) =>
                setConfig((c) => (c ? { ...c, enabled: !!v } : c))
              }
              aria-label="Bật tín hiệu đồng thuận"
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!config ? (
          <p className="text-xs text-muted-foreground">Đang tải…</p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Các khung phải cùng đồng thuận</Label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_ALERT_TFS.map((tf) => {
                  const active = config.timeframes.includes(tf);
                  return (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => toggleTf(tf)}
                      disabled={!config.enabled}
                      className={cnTf(active, config.enabled)}
                    >
                      {tf}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Đang chọn {config.timeframes.length} khung:{" "}
                {config.timeframes.join(" · ") || "—"}. Càng nhiều khung càng
                hiếm tín hiệu nhưng càng chắc.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border bg-card/40 p-3">
                <span className="text-sm">
                  📈 Báo đồng thuận <strong>BULLISH</strong>
                </span>
                <Switch
                  checked={config.notifyBullish}
                  disabled={!config.enabled}
                  onCheckedChange={(v) =>
                    setConfig((c) => (c ? { ...c, notifyBullish: !!v } : c))
                  }
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border bg-card/40 p-3">
                <span className="text-sm">
                  📉 Báo đồng thuận <strong>BEARISH</strong>
                </span>
                <Switch
                  checked={config.notifyBearish}
                  disabled={!config.enabled}
                  onCheckedChange={(v) =>
                    setConfig((c) => (c ? { ...c, notifyBearish: !!v } : c))
                  }
                />
              </label>
            </div>

            <Button size="sm" onClick={save} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Lưu cài đặt tín hiệu
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Pill style for timeframe toggles. */
function cnTf(active: boolean, enabled: boolean): string {
  return [
    "rounded-full border px-3 py-1 font-mono text-xs transition",
    active
      ? "border-primary bg-primary/15 text-primary"
      : "border-border bg-card/40 text-muted-foreground hover:text-foreground",
    !enabled && "pointer-events-none opacity-50",
  ]
    .filter(Boolean)
    .join(" ");
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
