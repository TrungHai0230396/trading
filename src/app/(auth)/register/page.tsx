import Link from "next/link";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground">
          One-time setup. Disable registration later via{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            ALLOW_REGISTRATION=false
          </code>
          .
        </p>
      </div>
      <RegisterForm />
      <p className="text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
