import { EmailVerification } from "@/components/dashboard/EmailVerification";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

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
  if (token) {
    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
    try {
      const response = await fetch(`${workerUrl}/api/auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": process.env.INTERNAL_SECRET || "",
        },
        body: JSON.stringify({ action: "verify-email", token }),
        cache: "no-store",
      });
      const data = await response.json() as { ok?: boolean };
      if (response.ok && data.ok) {
        redirect("/dashboard?login=true&verified=true");
      }
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "digest" in error
        && typeof error.digest === "string"
        && error.digest.startsWith("NEXT_REDIRECT")
      ) {
        throw error;
      }
    }
  }
  return <EmailVerification token="" />;
}
