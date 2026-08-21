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
  subscription?: BillingSubscriptionSnapshot | null;
}

export interface BillingSubscriptionSnapshot {
  id: string;
  provider: string;
  plan: string;
  billing_cycle: "monthly" | "yearly";
  status: "active" | "past_due" | "non_renewing" | "canceled";
  current_period_started_at: string;
  current_period_ends_at: string;
  next_charge_at: string;
  last_charged_at: string | null;
  last_failed_at: string | null;
  failure_count: number;
  cancel_requested_at: string | null;
  canceled_at: string | null;
}

export interface BillingOrderResponse {
  ok?: boolean;
  error?: string;
  reused?: boolean;
  order?: BillingPendingOrder;
}

export interface TossCheckoutPrepareResponse {
  ok?: boolean;
  error?: string;
  order?: BillingPendingOrder;
  checkout?: {
    provider: "toss_autobilling";
    client_key: string;
    customer_key: string;
    customer_email: string | null;
    customer_name: string | null;
    order_name: string;
    success_url: string;
    fail_url: string;
  };
}

export interface TossCheckoutConfirmResponse {
  ok?: boolean;
  error?: string;
  reused?: boolean;
  order?: BillingPendingOrder | null;
  payment?: {
    provider_payment_id: string;
    provider: string;
    method: string | null;
    amount: number;
    currency: string;
    status: string;
    approved_at: string | null;
    canceled_at: string | null;
  } | null;
  entitlement?: BillingActiveEntitlement | null;
  provider_flow?: {
    provider: "toss_autobilling";
    billing_key_issued: boolean;
    renewal_storage_pending: boolean;
    merchant_id: string | null;
  };
}

export interface BillingCancelResponse {
  ok?: boolean;
  error?: string;
  reused?: boolean;
  subscription?: BillingSubscriptionSnapshot | null;
}

export interface BillingOrderCancelResponse {
  ok?: boolean;
  error?: string;
  reused?: boolean;
  order_id?: string;
  status?: "canceled";
}

export async function fetchBillingState(): Promise<BillingStateResponse> {
  const response = await fetch("/api/billing", {
    method: "GET",
    cache: "no-store",
  });
  return response.json() as Promise<BillingStateResponse>;
}

export async function createBillingOrder(input: {
  plan: "plus";
  billing_cycle: "monthly" | "yearly";
}): Promise<BillingOrderResponse> {
  const response = await fetch("/api/billing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  return response.json() as Promise<BillingOrderResponse>;
}

export async function prepareTossCheckout(orderId: string): Promise<TossCheckoutPrepareResponse> {
  const response = await fetch("/api/billing/toss/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId }),
    cache: "no-store",
  });
  return response.json() as Promise<TossCheckoutPrepareResponse>;
}

export async function cancelBillingOrder(orderId: string): Promise<BillingOrderCancelResponse> {
  const response = await fetch("/api/billing/order/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId }),
    cache: "no-store",
    keepalive: true,
  });
  return response.json() as Promise<BillingOrderCancelResponse>;
}

export async function confirmTossCheckout(input: {
  order_id: string;
  auth_key: string;
  customer_key: string;
}): Promise<TossCheckoutConfirmResponse> {
  const response = await fetch("/api/billing/toss/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  return response.json() as Promise<TossCheckoutConfirmResponse>;
}

export async function cancelBillingSubscription(): Promise<BillingCancelResponse> {
  const response = await fetch("/api/billing/cancel", {
    method: "POST",
    cache: "no-store",
  });
  return response.json() as Promise<BillingCancelResponse>;
}
