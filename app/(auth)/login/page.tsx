import { LoginForm } from "@/features/auth/login-form";
import { safeNextPath } from "@/lib/safe-next";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; verified?: string; email?: string; reset?: string }>;
}) {
  const { next, verified, email, reset } = await searchParams;
  return (
    <LoginForm
      nextPath={safeNextPath(next)}
      justVerified={verified === "1"}
      justReset={reset === "1"}
      initialEmail={email ?? null}
    />
  );
}
