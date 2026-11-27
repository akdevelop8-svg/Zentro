import {
  AdminCustomerDetailPayload,
  AdminCustomerSummary,
  AdminOverviewData,
  AuditLogEntry,
  AuthSessionUser,
  BankAccountInfo,
  BroadcastItem,
  CustomerProfilePayload,
  DepositRequestItem,
  FeedbackItem,
  GiftCodeItem,
  PaymentSettings,
  VipPlan,
  WithdrawalRequestItem,
} from '../types/zentro';

// Bank deposit/withdrawal are separately gated from plans, rewards, and commissions.
export const BANK_TRANSFER_FEATURES_ENABLED = true;
export const GIFT_CODE_FEATURES_ENABLED = true;
export const FINANCIAL_FEATURES_ENABLED = true;

// Auth Bearer token stored strictly in JS memory (never localStorage/sessionStorage)
let inMemoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
}

export function clearAuthToken(): void {
  inMemoryToken = null;
}

export function hasAuthToken(): boolean {
  return Boolean(inMemoryToken);
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Requested-With', 'XMLHttpRequest');
  if (inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      typeof data.error === 'string'
        ? data.error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

// Auth & Bootstrap
export async function apiGetSession(): Promise<
  | { authenticated: true; token: string; user: AuthSessionUser }
  | { authenticated: false }
> {
  return apiRequest('/auth/session');
}

export async function apiLogout(): Promise<{ ok: boolean }> {
  return apiRequest('/auth/logout', { method: 'POST' });
}

export async function apiGetAdminBootstrapStatus(): Promise<{
  configured: boolean;
  adminUsername: string;
}> {
  return apiRequest('/auth/admin-bootstrap-status');
}

export async function apiBootstrapAdmin(
  password: string,
  confirmPassword: string
): Promise<{ ok: boolean }> {
  return apiRequest('/auth/admin-bootstrap', {
    method: 'POST',
    body: JSON.stringify({ password, confirmPassword }),
  });
}

export async function apiLogin(
  identifier: string,
  password: string
): Promise<{ token: string; user: AuthSessionUser }> {
  const res = await apiRequest<{ token: string; user: AuthSessionUser }>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }
  );
  setAuthToken(res.token);
  return res;
}

export async function apiRegister(payload: {
  name: string;
  phone: string;
  password: string;
  confirmPassword: string;
  invitationCode: string;
}): Promise<{ token: string; user: AuthSessionUser }> {
  const res = await apiRequest<{ token: string; user: AuthSessionUser }>(
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  setAuthToken(res.token);
  return res;
}

export async function apiGetPublicPaymentSettings(): Promise<
  PaymentSettings & { vipPlans: VipPlan[] }
> {
  return apiRequest('/payment-settings');
}

// Customer Endpoints
export async function apiGetMe(): Promise<CustomerProfilePayload> {
  return apiRequest('/me');
}

export async function apiAcceptTerms(): Promise<{ ok: boolean }> {
  return apiRequest('/me/accept-terms', { method: 'POST' });
}

export async function apiDailyCheckIn(): Promise<{
  ok: boolean;
  rewardEtb: number;
  lastCheckInAt: number;
  walletBalanceEtb: number;
}> {
  return apiRequest('/me/check-in', { method: 'POST' });
}

export async function apiSaveBankAccount(
  account: BankAccountInfo
): Promise<{ ok: boolean; bankAccount: BankAccountInfo }> {
  return apiRequest('/me/bank-account', {
    method: 'POST',
    body: JSON.stringify(account),
  });
}

export async function apiVerifyGiftCode(
  code: string
): Promise<{ ok: boolean; message: string }> {
  return apiRequest('/gift-code', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function apiMarkNotificationsRead(
  notificationId?: string
): Promise<{ ok: boolean }> {
  return apiRequest('/notifications/read', {
    method: 'POST',
    body: JSON.stringify(notificationId ? { notificationId } : {}),
  });
}

export async function apiBuyVipPlan(
  planId: string
): Promise<{ ok: boolean; walletBalanceEtb: number }> {
  return apiRequest('/plans/buy', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

export async function apiClaimVipDaily(planId: string): Promise<{
  ok: boolean;
  claimedDays: number;
  dailyIncomeEtb: number;
  walletBalanceEtb: number;
  nextCycleAt: number;
  status: string;
}> {
  return apiRequest(`/plans/${encodeURIComponent(planId)}/claim`, { method: 'POST' });
}

export async function apiBuyWelfarePlan(
  planId: string
): Promise<{ ok: boolean; id: string; walletBalanceEtb: number }> {
  return apiRequest('/welfare/buy', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

export async function apiClaimWelfareDaily(
  enrollmentId: string
): Promise<{
  ok: boolean;
  claimedDays: number;
  accumulatedEtb: number;
  releasedToWallet: boolean;
}> {
  return apiRequest(`/welfare/${encodeURIComponent(enrollmentId)}/claim`, {
    method: 'POST',
  });
}

export async function apiReleaseWelfareVault(
  enrollmentId: string
): Promise<{ ok: boolean; releasedEtb: number }> {
  return apiRequest(`/welfare/${encodeURIComponent(enrollmentId)}/release`, {
    method: 'POST',
  });
}

export async function apiCreateDeposit(payload: {
  amountEtb: number;
  referenceCode: string;
  paymentMethodId: string;
  receiptDataUrl: string;
}): Promise<{ ok: boolean; id: string }> {
  return apiRequest('/deposits', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiCreateWithdrawal(payload: {
  amountEtb: number;
  paymentMethodId: string;
}): Promise<{ ok: boolean; id: string; walletBalanceEtb: number }> {
  return apiRequest('/withdrawals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiSubmitSupport(payload: {
  category: string;
  subject: string;
  message: string;
}): Promise<{ ok: boolean; id: string }> {
  return apiRequest('/support', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Admin Endpoints
export async function apiAdminOverview(): Promise<AdminOverviewData> {
  return apiRequest('/admin/overview');
}

export async function apiAdminCustomers(
  q = '',
  status: 'All' | 'Active' | 'Suspended' = 'All'
): Promise<{ customers: AdminCustomerSummary[] }> {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (status !== 'All') params.set('status', status);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/admin/customers${suffix}`);
}

export async function apiAdminCustomerDetail(
  customerId: string
): Promise<AdminCustomerDetailPayload> {
  return apiRequest(`/admin/customers/${encodeURIComponent(customerId)}`);
}

export async function apiAdminToggleCustomerStatus(
  customerId: string,
  status: 'Active' | 'Suspended'
): Promise<{ ok: boolean; status: 'Active' | 'Suspended' }> {
  return apiRequest(`/admin/customers/${encodeURIComponent(customerId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function apiAdminDeposits(): Promise<{
  deposits: DepositRequestItem[];
}> {
  return apiRequest('/admin/deposits');
}

export async function apiAdminApproveDeposit(
  depositId: string
): Promise<{ ok: boolean }> {
  return apiRequest(
    `/admin/deposits/${encodeURIComponent(depositId)}/approve`,
    { method: 'POST' }
  );
}

export async function apiAdminRejectDeposit(
  depositId: string,
  reason: string
): Promise<{ ok: boolean }> {
  return apiRequest(
    `/admin/deposits/${encodeURIComponent(depositId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

export async function apiAdminWithdrawals(): Promise<{
  withdrawals: WithdrawalRequestItem[];
}> {
  return apiRequest('/admin/withdrawals');
}

export async function apiAdminApproveWithdrawal(
  withdrawalId: string
): Promise<{ ok: boolean }> {
  return apiRequest(
    `/admin/withdrawals/${encodeURIComponent(withdrawalId)}/approve`,
    { method: 'POST' }
  );
}

export async function apiAdminProcessWithdrawal(
  withdrawalId: string
): Promise<{ ok: boolean }> {
  return apiRequest(
    `/admin/withdrawals/${encodeURIComponent(withdrawalId)}/process`,
    { method: 'POST' }
  );
}

export async function apiAdminRejectWithdrawal(
  withdrawalId: string,
  reason: string
): Promise<{ ok: boolean }> {
  return apiRequest(
    `/admin/withdrawals/${encodeURIComponent(withdrawalId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

export async function apiAdminFeedback(): Promise<{
  feedback: FeedbackItem[];
}> {
  return apiRequest('/admin/feedback');
}

export async function apiAdminUpdateFeedbackStatus(
  feedbackId: string,
  status: 'Read' | 'Resolved'
): Promise<{ ok: boolean }> {
  return apiRequest(`/admin/feedback/${encodeURIComponent(feedbackId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function apiAdminReplyFeedback(
  feedbackId: string,
  reply: string
): Promise<{ ok: boolean }> {
  return apiRequest(`/admin/feedback/${encodeURIComponent(feedbackId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ reply }),
  });
}

export async function apiAdminBroadcasts(): Promise<{
  broadcasts: BroadcastItem[];
}> {
  return apiRequest('/admin/broadcasts');
}

export async function apiAdminSendBroadcast(payload: {
  title: string;
  message: string;
  imageDataUrl?: string;
  targetUserId?: string;
}): Promise<{ ok: boolean; id: string; imageFilename: string | null }> {
  return apiRequest('/admin/broadcasts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiAdminGetPaymentSettings(): Promise<PaymentSettings> {
  return apiRequest('/admin/payment-settings');
}

export async function apiAdminUpdatePaymentSettings(
  settings: PaymentSettings
): Promise<PaymentSettings> {
  return apiRequest('/admin/payment-settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function apiAdminGiftCodes(): Promise<{ giftCodes: GiftCodeItem[] }> {
  return apiRequest('/admin/gift-codes');
}

export async function apiAdminCreateGiftCode(payload: {
  amountEtb: number;
  maxRedemptions: number;
  expiresAt?: string | null;
}): Promise<{ ok: boolean; giftCode: GiftCodeItem }> {
  return apiRequest('/admin/gift-codes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiAdminRevokeGiftCode(code: string): Promise<{ ok: boolean; code: string }> {
  return apiRequest(`/admin/gift-codes/${encodeURIComponent(code)}/revoke`, {
    method: 'POST',
  });
}

export async function apiAdminAuditLogs(): Promise<{
  auditLogs: AuditLogEntry[];
}> {
  return apiRequest('/admin/audit-logs');
}

export function uploadImageUrl(filename?: string | null): string | null {
  if (!filename) return null;
  return `/api/uploads/${encodeURIComponent(filename)}`;
}
