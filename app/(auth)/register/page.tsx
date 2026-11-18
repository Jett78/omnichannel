import { RegisterForm } from "@/features/auth/register-form";
import { safeNextPath } from "@/lib/safe-next";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <RegisterForm nextPath={safeNextPath(next)} />;
}
