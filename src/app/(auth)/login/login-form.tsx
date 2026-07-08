"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleLoginButton } from "@/components/google-login-button";

const schema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(6, "Tối thiểu 6 ký tự"),
});
type FormValues = z.infer<typeof schema>;

export function LoginForm({
  googleEnabled = false,
  googleOnly = false,
}: {
  googleEnabled?: boolean;
  googleOnly?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";
  const [pending, setPending] = React.useState(false);

  // Google sign-in was refused because a password account already exists
  // for that email (see auth.ts account-takeover guard).
  React.useEffect(() => {
    if (params.get("error") === "use_password") {
      toast.error(
        "Email này đã đăng ký bằng mật khẩu. Hãy đăng nhập bằng mật khẩu.",
        { duration: 8000 },
      );
    }
  }, [params]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setPending(true);
    const res = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });
    setPending(false);

    if (!res || res.error) {
      toast.error("Email hoặc mật khẩu không đúng");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  });

  // Google-only: no email/password form, just the Google button (standalone,
  // no "hoặc" divider since there's nothing above it).
  if (googleOnly) {
    return (
      <div className="space-y-3">
        <GoogleLoginButton
          enabled={googleEnabled}
          callbackUrl={callbackUrl}
          standalone
        />
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="ban@example.com"
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
          autoComplete="current-password"
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-xs text-destructive">{errors.password.message}</p>
        ) : null}
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </Button>

      <GoogleLoginButton enabled={googleEnabled} callbackUrl={callbackUrl} />
    </form>
  );
}
