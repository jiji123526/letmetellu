"use client";

import { useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import type { PlatformOperationalHealthResponse } from "@/lib/api-support";

export function PlatformOperationalHealthCard({
  health,
  loading,
  error,
  onRefresh,
  onExpandedChange,
}: {
  health: PlatformOperationalHealthResponse | null;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const { locale, t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const status = health?.status || "healthy";
  const statusColor = status === "critical" ? "#dc2626" : status === "degraded" ? "#d97706" : "#16a34a";
  const statusLabel = status === "critical"
    ? t("operationalHealthCritical")
    : status === "degraded"
      ? t("operationalHealthDegraded")
      : t("operationalHealthHealthy");
  const recent = health?.windows.last_15m;
  const authMonitoring = health?.auth_monitoring;
  const problemRoutes = (health?.routes || []).filter((route) => (
    route.request_5xx_count
    || route.preview_upstream_failure_count
    || route.unhandled_exception_count
    || route.d1_unavailable_count
    || route.maintenance_failure_count
    || route.cleanup_failure_count
    || route.realtime_failure_count
    || route.rate_limited_count
    || route.media_not_found_count
  )).slice(0, 3);
  const updatedAt = health?.generated_at
    ? new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(health.generated_at))
    : "";

  return (
    <section className="px-4 pt-3 pb-1" aria-label={t("operationalHealthTitle")}>
      <div className="rounded-[16px] p-3" style={{ background: "var(--card)" }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: statusColor }} />
              <h2 className="m-0 text-[14px] font-semibold">{t("operationalHealthTitle")}</h2>
              {health && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: statusColor, background: `color-mix(in srgb, ${statusColor} 12%, var(--card))` }}>
                  {statusLabel}
                </span>
              )}
            </div>
            <p className="mt-1 mb-0 text-[11px]" style={{ color: "var(--meta)" }}>
              {error ? t("operationalHealthLoadFailed") : loading && !health ? t("operationalHealthLoading") : t("operationalHealthLast15m")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {expanded && (
              <button
                type="button"
                className="border-none bg-transparent cursor-pointer text-[12px] font-medium disabled:opacity-50"
                style={{ color: "var(--tint)" }}
                disabled={loading}
                onClick={onRefresh}
              >
                {loading ? t("operationalHealthRefreshing") : t("operationalHealthRefresh")}
              </button>
            )}
            <button
              type="button"
              className="w-7 h-7 border-none rounded-full cursor-pointer flex items-center justify-center text-[14px]"
              style={{ color: "var(--meta)", background: "var(--bg)" }}
              aria-expanded={expanded}
              onClick={() => {
                const nextExpanded = !expanded;
                setExpanded(nextExpanded);
                onExpandedChange?.(nextExpanded);
                if (nextExpanded && !health && !loading) onRefresh();
              }}
            >
              {expanded ? "⌃" : "⌄"}
            </button>
          </div>
        </div>

        {expanded && recent && (
          <>
            <div className="grid grid-cols-3 gap-1.5 mt-3">
              {[
                [t("operationalHealth5xx"), recent.request_5xx_count],
                [t("operationalHealthPreviewFailures"), recent.preview_upstream_failure_count],
                [t("operationalHealthExceptions"), recent.unhandled_exception_count],
                [t("operationalHealthD1Failures"), recent.d1_unavailable_count],
                [t("operationalHealthCleanupFailures"), recent.cleanup_failure_count],
                [t("operationalHealthRealtimeFailures"), recent.realtime_failure_count],
                ["429", recent.rate_limited_count],
                ["403", recent.forbidden_count],
                [t("operationalHealthMediaMisses"), recent.media_not_found_count],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-[10px] px-2 py-2 text-center" style={{ background: "var(--bg)" }}>
                  <div className="text-[15px] font-semibold tabular-nums">{value}</div>
                  <div className="mt-0.5 text-[9px] truncate" style={{ color: "var(--meta)" }}>{label}</div>
                </div>
              ))}
            </div>
            {authMonitoring && (
              <div className="mt-3 pt-2.5" style={{ borderTop: "0.5px solid var(--hairline)" }}>
                <div className="text-[10px] font-semibold mb-1.5" style={{ color: "var(--meta)" }}>
                  {t("operationalAuthMonitoring").replace("{hours}", String(authMonitoring.window_hours))}
                </div>
                <div className="flex flex-col gap-1.5">
                  {[
                    {
                      label: t("operationalAuthVerification"),
                      value: t("operationalAuthEmailCounts")
                        .replace("{sent}", String(authMonitoring.email_verification.sent))
                        .replace("{completed}", String(authMonitoring.email_verification.completed))
                        .replace("{failed}", String(authMonitoring.email_verification.delivery_failed)),
                      failed: authMonitoring.email_verification.delivery_failed,
                    },
                    {
                      label: t("operationalAuthPasswordReset"),
                      value: t("operationalAuthEmailCounts")
                        .replace("{sent}", String(authMonitoring.password_reset.sent))
                        .replace("{completed}", String(authMonitoring.password_reset.completed))
                        .replace("{failed}", String(authMonitoring.password_reset.delivery_failed)),
                      failed: authMonitoring.password_reset.delivery_failed,
                    },
                    {
                      label: t("operationalAuthLegacyUpgrade"),
                      value: t("operationalAuthUpgradeCounts")
                        .replace("{succeeded}", String(authMonitoring.legacy_password_upgrade.succeeded))
                        .replace("{failed}", String(authMonitoring.legacy_password_upgrade.failed))
                        .replace("{remaining}", String(authMonitoring.legacy_password_upgrade.remaining)),
                      failed: authMonitoring.legacy_password_upgrade.failed,
                    },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 text-[10px]">
                      <span className="font-medium">{item.label}</span>
                      <span
                        className="shrink-0 tabular-nums"
                        style={{ color: item.failed > 0 ? "#dc2626" : "var(--meta)" }}
                      >
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {problemRoutes.length > 0 && (
              <div className="mt-3 pt-2.5" style={{ borderTop: "0.5px solid var(--hairline)" }}>
                <div className="text-[10px] font-semibold mb-1.5" style={{ color: "var(--meta)" }}>{t("operationalHealthProblemRoutes")}</div>
                <div className="flex flex-col gap-1.5">
                  {problemRoutes.map((route) => (
                    <div key={route.route} className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="truncate font-medium">{route.route}</span>
                      <span className="shrink-0 tabular-nums" style={{ color: "var(--meta)" }}>
                        {t("operationalHealthRouteCounts")
                          .replace("{errors}", String(route.request_5xx_count + route.preview_upstream_failure_count + route.unhandled_exception_count + route.d1_unavailable_count + route.maintenance_failure_count + route.cleanup_failure_count + route.realtime_failure_count))
                          .replace("{missing}", String(route.media_not_found_count))
                          .replace("{limited}", String(route.rate_limited_count))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-2.5 pt-2.5 flex items-center justify-between gap-3 text-[10px]" style={{ borderTop: "0.5px solid var(--hairline)" }}>
              <span style={{ color: "var(--meta)" }}>{t("operationalHealthAlerting")}</span>
              <span className="font-medium" style={{ color: health.alerting.enabled ? "#16a34a" : "#dc2626" }}>
                {health.alerting.enabled
                  ? t("operationalHealthAlertingEnabled").replace("{minutes}", String(health.alerting.evaluation_interval_minutes))
                  : t("operationalHealthAlertingDisabled")}
              </span>
            </div>
            {updatedAt && (
              <p className="mt-2.5 mb-0 text-right text-[9px]" style={{ color: "var(--meta)" }}>
                {t("operationalHealthUpdated").replace("{time}", updatedAt)}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
