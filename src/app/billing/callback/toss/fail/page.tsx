"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function TossBillingFailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code") || "unknown";
  const message = searchParams.get("message") || "Payment authorization failed.";

  return (
    <main className="min-h-screen px-5 py-10" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="mx-auto w-full max-w-[420px] rounded-[24px] p-6" style={{ background: "var(--card)", boxShadow: "0 24px 70px rgba(0,0,0,.12)" }}>
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--meta)" }}>
          Toss Payments
        </div>
        <h1 className="mt-2 mb-2 text-[24px] font-semibold">Checkout failed</h1>
        <p className="m-0 text-[14px] leading-[1.6]" style={{ color: "var(--meta)" }}>
          {message}
        </p>
        <div className="mt-3 text-[12px]" style={{ color: "var(--meta)" }}>
          Code: {code}
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-[14px] border-none px-4 py-3 text-[14px] font-semibold"
            style={{ background: "#007aff", color: "#fff" }}
            onClick={() => router.push("/dashboard")}
          >
            Back to dashboard
          </button>
        </div>
      </div>
    </main>
  );
}
