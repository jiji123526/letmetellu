import { EmailVerification } from "@/components/dashboard/EmailVerification";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify email · Let Me Tell U",
  referrer: "no-referrer",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const tokenValue = (await searchParams).token;
  const token = typeof tokenValue === "string" ? tokenValue : "";
  return <EmailVerification token={token} />;
}
