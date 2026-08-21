"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import {
  cancelBillingOrder,
  prepareTossCheckout,
  type TossCheckoutPrepareResponse,
} from "@/lib/api-billing";
import { useLocale } from "@/hooks/useLocale";

export default function BillingCheckoutPage() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id") || "";
  const [state, setState] = useState<TossCheckoutPrepareResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(orderId));
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState(orderId ? "" : "missing_order_id");
  const checkoutStartedRef = useRef(false);
  const cancellationSentRef = useRef(false);

  useEffect(() => {
    if (!orderId) return;

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

  useEffect(() => {
    const cancelBeforeLeaving = () => {
      if (!orderId || checkoutStartedRef.current || cancellationSentRef.current) return;
      const body = new Blob(
        [JSON.stringify({ order_id: orderId })],
        { type: "application/json" },
      );
      if (navigator.sendBeacon("/api/billing/order/cancel", body)) {
        cancellationSentRef.current = true;
      }
    };
    window.addEventListener("pagehide", cancelBeforeLeaving);
    return () => window.removeEventListener("pagehide", cancelBeforeLeaving);
  }, [orderId]);

  const cancelPendingOrder = async () => {
    if (!orderId || cancellationSentRef.current) return;
    cancellationSentRef.current = true;
    try {
      const response = await cancelBillingOrder(orderId);
      if (!response.ok) {
        throw new Error(response.error || "order_cancel_failed");
      }
    } catch (cancelError) {
      cancellationSentRef.current = false;
      throw cancelError;
    }
  };

  const startCheckout = async () => {
    if (!state?.checkout?.client_key || !state.checkout.customer_key) return;
    setStarting(true);
    setError("");
    try {
      const tossPayments = await loadTossPayments(state.checkout.client_key);
      const payment = tossPayments.payment({
        customerKey: state.checkout.customer_key,
      });
      checkoutStartedRef.current = true;
      await payment.requestBillingAuth({
        method: "CARD",
        successUrl: state.checkout.success_url,
        failUrl: state.checkout.fail_url,
        customerEmail: state.checkout.customer_email || undefined,
        customerName: state.checkout.customer_name || undefined,
      });
    } catch (startError) {
      checkoutStartedRef.current = false;
      try {
        await cancelPendingOrder();
        setState(null);
      } catch {
        // Keep the prepared checkout available so cancellation can be retried.
      }
      setError(startError instanceof Error ? startError.message : "checkout_failed");
      setStarting(false);
    }
  };

  const closeCheckout = async () => {
    if (cancelling) return;
    setCancelling(true);
    setError("");
    try {
      await cancelPendingOrder();
      router.replace("/dashboard");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "order_cancel_failed");
      setCancelling(false);
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
              {state.order.currency} {state.order.amount.toLocaleString()} · {t("billingTaxIncluded")}
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
            style={{ background: "var(--bg)", color: "var(--gray-text)", opacity: cancelling ? 0.7 : 1 }}
            disabled={cancelling}
            onClick={() => void closeCheckout()}
          >
            {cancelling ? t("loading") : t("close")}
          </button>
        </div>
      </div>
    </main>
  );
}
