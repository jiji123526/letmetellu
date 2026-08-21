"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { prepareTossCheckout, type TossCheckoutPrepareResponse } from "@/lib/api-billing";
import { useLocale } from "@/hooks/useLocale";

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => {
      requestBillingAuth: (
        method: "카드",
        options: {
          customerKey: string;
          successUrl: string;
          failUrl: string;
          customerEmail?: string | null;
          customerName?: string | null;
        },
      ) => Promise<void>;
    };
  }
}

function loadTossPaymentsScript(): Promise<void> {
  if (typeof window !== "undefined" && window.TossPayments) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-toss-payments="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("toss_script_failed")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://js.tosspayments.com/v1/payment";
    script.async = true;
    script.dataset.tossPayments = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("toss_script_failed"));
    document.head.appendChild(script);
  });
}

export default function BillingCheckoutPage() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id") || "";
  const [state, setState] = useState<TossCheckoutPrepareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderId) {
      setError("missing_order_id");
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await prepareTossCheckout(orderId);
        if (!data.ok || !data.checkout?.client_key) {
          throw new Error(data.error || "prepare_failed");
        }
        if (!cancelled) {
          setState(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "prepare_failed");
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
  }, [orderId]);

  const startCheckout = async () => {
    if (!state?.checkout?.client_key || !state.checkout.customer_key) return;
    setStarting(true);
    setError("");
    try {
      await loadTossPaymentsScript();
      if (!window.TossPayments) {
        throw new Error("toss_unavailable");
      }
      const tossPayments = window.TossPayments(state.checkout.client_key);
      await tossPayments.requestBillingAuth("카드", {
        customerKey: state.checkout.customer_key,
        successUrl: state.checkout.success_url,
        failUrl: state.checkout.fail_url,
        customerEmail: state.checkout.customer_email,
        customerName: state.checkout.customer_name,
      });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "checkout_failed");
      setStarting(false);
    }
  };

  return (
    <main className="min-h-screen px-5 py-10" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="mx-auto w-full max-w-[420px] rounded-[24px] p-6" style={{ background: "var(--card)", boxShadow: "0 24px 70px rgba(0,0,0,.12)" }}>
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--meta)" }}>
          Toss Payments
        </div>
        <h1 className="mt-2 mb-2 text-[24px] font-semibold">Plus checkout</h1>
        <p className="m-0 text-[14px] leading-[1.6]" style={{ color: "var(--meta)" }}>
          {loading
            ? t("loading")
            : state?.order
              ? `${state.order.billing_cycle === "yearly" ? "365" : "30"} day Plus checkout`
              : "Unable to prepare checkout."}
        </p>

        {state?.order ? (
          <div className="mt-5 rounded-[18px] p-4" style={{ background: "var(--bg)" }}>
            <div className="text-[13px]" style={{ color: "var(--meta)" }}>Order</div>
            <div className="mt-1 text-[16px] font-semibold">{state.checkout?.order_name}</div>
            <div className="mt-1 text-[13px]" style={{ color: "var(--meta)" }}>
              {state.order.currency} {state.order.amount.toLocaleString()}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-[14px] px-4 py-3 text-[13px]" style={{ background: "#fff1f2", color: "#be123c" }}>
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-[14px] border-none px-4 py-3 text-[14px] font-semibold"
            style={{ background: "#007aff", color: "#fff", opacity: loading || starting || !state?.checkout ? 0.7 : 1 }}
            disabled={loading || starting || !state?.checkout}
            onClick={() => void startCheckout()}
          >
            {starting ? t("dashboardPlanCheckoutProcessing") : t("dashboardPlanCheckoutStart")}
          </button>
          <button
            type="button"
            className="rounded-[14px] border-none px-4 py-3 text-[14px] font-semibold"
            style={{ background: "var(--bg)", color: "var(--gray-text)" }}
            onClick={() => router.push("/dashboard")}
          >
            {t("close")}
          </button>
        </div>
      </div>
    </main>
  );
}
