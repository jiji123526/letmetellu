import type { Env } from "../types";
import { recordOperationalEvent } from "./operational-events.ts";

export type AuthMonitoringEventType =
  | "email_verification_sent"
  | "email_verification_completed"
  | "email_verification_delivery_failed"
  | "password_reset_sent"
  | "password_reset_completed"
  | "password_reset_delivery_failed"
  | "legacy_password_upgrade_succeeded"
  | "legacy_password_upgrade_failed";

export interface AuthMonitoringRow {
  email_verification_sent_count?: number | string | null;
  email_verification_completed_count?: number | string | null;
  email_verification_delivery_failed_count?: number | string | null;
  password_reset_sent_count?: number | string | null;
  password_reset_completed_count?: number | string | null;
  password_reset_delivery_failed_count?: number | string | null;
  legacy_password_upgrade_succeeded_count?: number | string | null;
  legacy_password_upgrade_failed_count?: number | string | null;
  remaining_legacy_password_count?: number | string | null;
  last_failure_at?: string | null;
}

export interface AuthMonitoringSummary {
  window_hours: 24;
  email_verification: {
    sent: number;
    completed: number;
    delivery_failed: number;
  };
  password_reset: {
    sent: number;
    completed: number;
    delivery_failed: number;
  };
  legacy_password_upgrade: {
    succeeded: number;
    failed: number;
    remaining: number;
  };
  last_failure_at: string | null;
}

function count(value: number | string | null | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function serializeAuthMonitoringSummary(
  row: AuthMonitoringRow | null | undefined,
): AuthMonitoringSummary {
  return {
    window_hours: 24,
    email_verification: {
      sent: count(row?.email_verification_sent_count),
      completed: count(row?.email_verification_completed_count),
      delivery_failed: count(row?.email_verification_delivery_failed_count),
    },
    password_reset: {
      sent: count(row?.password_reset_sent_count),
      completed: count(row?.password_reset_completed_count),
      delivery_failed: count(row?.password_reset_delivery_failed_count),
    },
    legacy_password_upgrade: {
      succeeded: count(row?.legacy_password_upgrade_succeeded_count),
      failed: count(row?.legacy_password_upgrade_failed_count),
      remaining: count(row?.remaining_legacy_password_count),
    },
    last_failure_at: row?.last_failure_at || null,
  };
}

export async function recordAuthMonitoringEvent(input: {
  env: Env;
  eventType: AuthMonitoringEventType;
  actorUserId: string;
  severity?: "info" | "warn";
  statusCode?: number;
}): Promise<void> {
  await recordOperationalEvent({
    env: input.env,
    severity: input.severity || "info",
    route: "POST /api/auth",
    eventType: input.eventType,
    statusCode: input.statusCode,
    actorUserId: input.actorUserId,
  });
}
