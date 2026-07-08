"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { GoogleLoginButton } from "@/components/google-login-button";

const schema = z.object({
  name: z.string().trim().min(1, "Bắt buộc"),
  email: z.string().email("Email không hợp lệ"),
  password: z
    .string()
    .min(8, "Tối thiểu 8 ký tự")
    .regex(/[a-zA-Z]/, "Cần ít nhất 1 chữ cái")
    .regex(/[0-9]/, "Cần ít nhất 1 chữ số"),
  acceptTerms: z.boolean().refine((v) => v === true, {
    message: "Bạn cần đồng ý Điều khoản để tạo tài khoản",
  }),
});
type FormValues = z.infer<typeof schema>;

export function RegisterForm({
  googleEnabled = false,
}: {
  googleEnabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { acceptTerms: false },
  });
  const accepted = watch("acceptTerms");

  const onSubmit = handleSubmit(async (values) => {
    setPending(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        toast.error(data.error ?? "Đăng ký thất bại");
        return;
      }

      const signInRes = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      });
      if (!signInRes || signInRes.error) {
        toast.error("Đã tạo tài khoản — vui lòng đăng nhập");
        router.push("/login");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setPending(false);
    }
  });

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">Tên</Label>
        <Input id="name" autoComplete="name" {...register("name")} />
        {errors.name ? (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          {...register("email")}
        />
        {errors.email ? (
          <p className="text-xs text-destructive">{errors.email.message}</p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Mật khẩu</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register("password")}
        />
        <p className="text-[11px] text-muted-foreground">
          Tối thiểu 8 ký tự, gồm chữ và số.
        </p>
        {errors.password ? (
          <p className="text-xs text-destructive">{errors.password.message}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border bg-card/40 p-3">
          <Checkbox
            checked={accepted}
            onCheckedChange={(v) =>
              setValue("acceptTerms", v === true, { shouldValidate: true })
            }
            aria-label="Đồng ý điều khoản"
          />
          <span className="text-xs leading-relaxed text-muted-foreground">
            Tôi đã đọc và đồng ý với{" "}
            <Link
              href="/terms"
              target="_blank"
              className="font-medium text-primary hover:underline"
            >
              Điều khoản sử dụng & Miễn trừ trách nhiệm
            </Link>
            . Tôi hiểu rằng đây là công cụ hỗ trợ, không phải lời khuyên đầu
            tư, và tôi tự chịu trách nhiệm với mọi quyết định giao dịch.
          </span>
        </label>
        {errors.acceptTerms ? (
          <p className="text-xs text-destructive">
            {errors.acceptTerms.message}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Đang tạo tài khoản…" : "Tạo tài khoản"}
      </Button>

      <GoogleLoginButton enabled={googleEnabled} />
    </form>
  );
}
