export type BillingPlanCode = "plus";
export type BillingCycle = "monthly" | "yearly";
export type BillingProvider = "toss_autobilling";
export type BillingCurrency = "KRW";
export type BillingTaxMode = "vat_exclusive";

export interface BillingPlanSelection {
  plan: BillingPlanCode;
  billingCycle: BillingCycle;
  provider: BillingProvider;
  amount: number;
  currency: BillingCurrency;
  autoRenews: true;
  taxMode: BillingTaxMode;
  durationDays: number;
}

export const DEFAULT_BILLING_PROVIDER: BillingProvider = "toss_autobilling";
export const BILLING_ORDER_TTL_MINUTES = 30;

const BILLING_PLAN_CATALOG: readonly BillingPlanSelection[] = [
  {
    plan: "plus",
    billingCycle: "monthly",
    provider: DEFAULT_BILLING_PROVIDER,
    amount: 2900,
    currency: "KRW",
    autoRenews: true,
    taxMode: "vat_exclusive",
    durationDays: 30,
  },
  {
    plan: "plus",
    billingCycle: "yearly",
    provider: DEFAULT_BILLING_PROVIDER,
    amount: 17000,
    currency: "KRW",
    autoRenews: true,
    taxMode: "vat_exclusive",
    durationDays: 365,
  },
] as const;

export function getBillingPlanCatalog(): readonly BillingPlanSelection[] {
  return BILLING_PLAN_CATALOG;
}

export function resolveBillingPlanSelection(input: {
  plan?: unknown;
  billingCycle?: unknown;
  provider?: unknown;
}): BillingPlanSelection | null {
  const plan = typeof input.plan === "string" ? input.plan : "";
  const billingCycle = typeof input.billingCycle === "string" ? input.billingCycle : "";
  const provider = typeof input.provider === "string" && input.provider
    ? input.provider
    : DEFAULT_BILLING_PROVIDER;

  return BILLING_PLAN_CATALOG.find((entry) => (
    entry.plan === plan
    && entry.billingCycle === billingCycle
    && entry.provider === provider
  )) || null;
}

export function calculateBillingOrderExpiresAt(
  now = new Date().toISOString(),
  ttlMinutes = BILLING_ORDER_TTL_MINUTES,
): string {
  const base = new Date(now);
  return new Date(base.getTime() + ttlMinutes * 60_000).toISOString();
}

export function calculateBillingEntitlementEndsAt(
  startsAt: string,
  durationDays: number,
): string {
  const base = new Date(startsAt);
  return new Date(base.getTime() + durationDays * 24 * 60 * 60_000).toISOString();
}
