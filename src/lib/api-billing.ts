export interface BillingPlanCatalogEntry {
  plan: "plus";
  billing_cycle: "monthly" | "yearly";
  provider: string;
  amount: number;
  currency: string;
  auto_renews: boolean;
  tax_mode: "vat_exclusive";
  duration_days: number;
}

export interface BillingActiveEntitlement {
  id: string;
  plan: "plus";
  status: string;
  provider: string | null;
  starts_at: string;
  ends_at: string | null;
  source_type: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  auto_renews: boolean;
}

export interface BillingPendingOrder {
  order_id: string;
  plan: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  provider: string;
  provider_order_id: string | null;
  status: string;
  auto_renews: boolean;
  expires_at: string | null;
  tax_mode: string;
}

export interface BillingStateResponse {
  ok?: boolean;
  error?: string;
  plans?: BillingPlanCatalogEntry[];
  active_entitlement?: BillingActiveEntitlement | null;
  latest_pending_order?: BillingPendingOrder | null;
}

export async function fetchBillingState(): Promise<BillingStateResponse> {
  const response = await fetch("/api/billing", {
    method: "GET",
    cache: "no-store",
  });
  return response.json() as Promise<BillingStateResponse>;
}
