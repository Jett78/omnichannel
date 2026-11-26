import { VerifyEmailNotice } from "@/features/auth/verify-email-notice";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return <VerifyEmailNotice initialEmail={email ?? null} />;
}
