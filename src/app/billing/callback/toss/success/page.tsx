"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmTossCheckout, type TossCheckoutConfirmResponse } from "@/lib/api-billing";
import { AdminGuidePanel } from "@/components/admin/AdminGuidePanel";
import { useLocale } from "@/hooks/useLocale";

export default function TossBillingSuccessPage() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id") || "";
  const authKey = searchParams.get("authKey") || "";
  const customerKey = searchParams.get("customerKey") || "";
  const hasCallbackParams = Boolean(orderId && authKey && customerKey);
  const [loading, setLoading] = useState(hasCallbackParams);
  const [result, setResult] = useState<TossCheckoutConfirmResponse | null>(null);
  const [error, setError] = useState(hasCallbackParams ? "" : "missing_callback_params");
  const [showAdminGuide, setShowAdminGuide] = useState(false);

  useEffect(() => {
    if (!orderId || !authKey || !customerKey) return;

    let cancelled = false;
    void (async () => {
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

  const features = [
    t("billingSuccessFeatureChannels"),
    t("billingSuccessFeatureCustomization"),
    t("billingSuccessFeatureImages"),
    t("billingSuccessFeatureLive"),
    t("billingSuccessFeatureAds"),
  ];
  const confirmed = Boolean(result?.ok && !error);

  return (
    <main className="min-h-screen px-5 py-10" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="mx-auto w-full max-w-[420px] rounded-[24px] p-6" style={{ background: "var(--card)", boxShadow: "0 24px 70px rgba(0,0,0,.12)" }}>
        <div className="text-[12px] font-semibold" style={{ color: "var(--meta)" }}>
          {t("billingSuccessEyebrow")}
        </div>
        <h1 className="mt-2 mb-2 text-[24px] font-semibold">
          {loading ? t("loading") : error ? t("billingSuccessFailed") : t("billingSuccessTitle")}
        </h1>
        <p className="m-0 text-[14px] leading-[1.6]" style={{ color: "var(--meta)" }}>
          {loading
            ? t("billingSuccessConfirming")
            : error
              ? t("dashboardPlanCheckoutFailed")
              : t("billingSuccessDescription")}
        </p>

        {confirmed && (
          <>
            <div className="mt-5 overflow-hidden rounded-[16px]" style={{ background: "var(--bg)" }}>
              {features.map((feature, index) => (
                <div
                  key={feature}
                  className="flex items-center gap-3 px-4 py-3 text-[13px]"
                  style={{ borderBottom: index < features.length - 1 ? "0.5px solid var(--hairline)" : "none" }}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold" style={{ background: "#e8f6ee", color: "#166534" }}>✓</span>
                  <span>{feature}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-[14px] border-none px-4 py-3 text-[14px] font-semibold"
                style={{ background: "#007aff", color: "#fff" }}
                onClick={() => router.push("/dashboard?onboarding=true")}
              >
                {t("billingSuccessCreateChannel")}
              </button>
              <button
                type="button"
                className="flex-1 rounded-[14px] border-none px-4 py-3 text-[14px] font-semibold"
                style={{ background: "var(--bg)", color: "var(--gray-text)" }}
                onClick={() => setShowAdminGuide(true)}
              >
                {t("billingSuccessOpenAdminGuide")}
              </button>
            </div>
          </>
        )}

        {!loading && !confirmed && (
          <button
            type="button"
            className="mt-6 w-full rounded-[14px] border-none px-4 py-3 text-[14px] font-semibold"
            style={{ background: "#007aff", color: "#fff" }}
            onClick={() => router.push("/dashboard")}
          >
            {t("dashboardBack")}
          </button>
        )}
      </div>
      {showAdminGuide && <AdminGuidePanel onClose={() => setShowAdminGuide(false)} />}
    </main>
  );
}
