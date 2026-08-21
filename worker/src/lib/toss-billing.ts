export interface TossBillingKeyIssueResponse {
  billingKey: string;
  customerKey: string;
}

export interface TossBillingChargeResponse {
  paymentKey: string;
  orderId: string;
  totalAmount: number;
  currency: string;
  status: string;
  type: string;
  method?: string;
  approvedAt?: string;
  mId?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidTossBillingKeyIssue(
  data: Record<string, unknown>,
  expectedCustomerKey: string,
): data is Record<string, unknown> & TossBillingKeyIssueResponse {
  return isNonEmptyString(data.billingKey)
    && data.customerKey === expectedCustomerKey;
}

export function isValidTossBillingCharge(
  data: Record<string, unknown>,
  expected: {
    orderId: string;
    amount: number;
    currency: string;
  },
): data is Record<string, unknown> & TossBillingChargeResponse {
  return isNonEmptyString(data.paymentKey)
    && data.status === "DONE"
    && data.type === "BILLING"
    && data.orderId === expected.orderId
    && Number.isInteger(data.totalAmount)
    && data.totalAmount === expected.amount
    && data.currency === expected.currency;
}
