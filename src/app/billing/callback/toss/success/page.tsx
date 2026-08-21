"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmTossCheckout, type TossCheckoutConfirmResponse } from "@/lib/api-billing";
import { useLocale } from "@/hooks/useLocale";

export default function TossBillingSuccessPage() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id") || "";
  const authKey = searchParams.get("authKey") || "";
  const customerKey = searchParams.get("customerKey") || "";
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<TossCheckoutConfirmResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderId || !authKey || !customerKey) {
      setError("missing_callback_params");
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const response = await confirmTossCheckout({
          order_id: orderId,
          auth_key: authKey,
          customer_key: customerKey,
        });
        if (!response.ok) {
          throw new Error(response.error || "confirm_failed");
        }
        if (!cancelled) {
          setResult(response);
        }
      } catch (confirmError) {
        if (!cancelled) {
          setError(confirmError instanceof Error ? confirmError.message : "confirm_failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authKey, customerKey, orderId]);

  return (
    <main className="min-h-screen px-5 py-10" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="mx-auto w-full max-w-[420px] rounded-[24px] p-6" style={{ background: "var(--card)", boxShadow: "0 24px 70px rgba(0,0,0,.12)" }}>
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--meta)" }}>
          Toss Payments
        </div>
        <h1 className="mt-2 mb-2 text-[24px] font-semibold">
          {loading ? t("loading") : error ? "Checkout failed" : "Plus activated"}
        </h1>
        <p className="m-0 text-[14px] leading-[1.6]" style={{ color: "var(--meta)" }}>
          {loading
            ? "Confirming your payment with the server."
            : error
              ? error
              : result?.entitlement?.ends_at
                ? `Plus is active until ${result.entitlement.ends_at}.`
                : "Plus is active now."}
        </p>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-[14px] border-none px-4 py-3 text-[14px] font-semibold"
            style={{ background: "#007aff", color: "#fff" }}
            onClick={() => router.push("/dashboard")}
          >
            Dashboard
          </button>
        </div>
      </div>
    </main>
  );
}
