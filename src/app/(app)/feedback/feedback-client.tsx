"use client";

import * as React from "react";
import { toast } from "sonner";
import { Bug, Sparkles, MessageCircle, Loader2, Send } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type FType = "BUG" | "FEATURE" | "OTHER";

const TYPES: { value: FType; label: string; icon: typeof Bug; hint: string }[] =
  [
    { value: "BUG", label: "Báo lỗi", icon: Bug, hint: "Gặp lỗi, sai số liệu, trang trắng…" },
    { value: "FEATURE", label: "Tính năng mới", icon: Sparkles, hint: "Muốn Nhật Ký Trade có thêm gì?" },
    { value: "OTHER", label: "Góp ý khác", icon: MessageCircle, hint: "Trải nghiệm, câu hỏi, lời chào…" },
  ];

export function FeedbackClient({ email }: { email: string | null }) {
  const [type, setType] = React.useState<FType>("BUG");
  const [message, setMessage] = React.useState("");
  const [context, setContext] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const submit = async () => {
    if (message.trim().length < 5) {
      toast.error("Viết cụ thể hơn một chút giúp mình nhé (≥ 5 ký tự).");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          message: message.trim(),
          context: context.trim() || undefined,
        }),
      });
      const d = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(d?.error ?? `Lỗi ${res.status}`);
        return;
      }
      setSent(true);
      setMessage("");
      setContext("");
      toast.success("Đã gửi — cảm ơn bạn rất nhiều! 🙌");
    } catch {
      toast.error("Không gửi được — kiểm tra kết nối mạng rồi thử lại.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Send className="size-5" />
          </div>
          <div>
            <p className="font-medium">Đã nhận được phản hồi của bạn</p>
            <p className="text-sm text-muted-foreground">
              Cảm ơn đã giúp Nhật Ký Trade tốt hơn. Cần báo thêm gì cứ gửi tiếp nhé.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSent(false)}>
            Gửi phản hồi khác
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gửi phản hồi</CardTitle>
        <CardDescription>
          Nhật Ký Trade đang trong giai đoạn thử nghiệm — mọi báo lỗi và ý tưởng đều quý.
          {email ? (
            <>
              {" "}
              Mình sẽ liên hệ lại qua{" "}
              <span className="font-medium text-foreground">{email}</span> nếu
              cần.
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label>Loại phản hồi</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {TYPES.map((t) => {
              const Icon = t.icon;
              const active = type === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition",
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                      : "bg-card/40 hover:border-border hover:bg-accent/40",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon
                      className={cn(
                        "size-4",
                        active ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    {t.label}
                  </span>
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    {t.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fb-message">Nội dung</Label>
          <Textarea
            id="fb-message"
            rows={6}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              type === "BUG"
                ? "Bạn đang làm gì thì gặp lỗi? Lỗi hiện ra sao? Càng cụ thể càng dễ sửa."
                : type === "FEATURE"
                  ? "Bạn muốn Nhật Ký Trade làm được thêm điều gì, và để giải quyết việc gì?"
                  : "Chia sẻ bất cứ điều gì bạn nghĩ tới…"
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fb-context">
            Trang gặp vấn đề{" "}
            <span className="text-xs font-normal text-muted-foreground">
              (không bắt buộc)
            </span>
          </Label>
          <Input
            id="fb-context"
            maxLength={191}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="vd: Tổng quan, Quét đa khung, Nhật ký…"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={sending}>
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Gửi phản hồi
          </Button>
          <span className="text-xs text-muted-foreground">
            {message.length}/4000
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
