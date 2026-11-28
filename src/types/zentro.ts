export type UserRole = 'customer' | 'admin';

export type CustomerStatus = 'Active' | 'Suspended';

export interface BankAccountInfo {
  accountName: string;
  accountNumber: string;
  method: string;
}

export interface CheckInHistoryItem {
  id: string;
  timestamp: string;
  rewardEtb: number;
}

export interface AuthSessionUser {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  termsAccepted?: boolean;
}

export interface CustomerAccount {
  id: string;
  name: string;
  phone: string;
  role: 'customer';
  status: CustomerStatus;
  invitationCode: string;
  invitedByCode?: string;
  walletBalanceEtb: number;
  totalDepositEtb: number;
  totalWithdrawEtb: number;
  totalCommissionEtb: number;
  lastCheckInAt: number | null;
  termsAccepted: boolean;
  registeredAt: string;
  bankAccount?: BankAccountInfo;
}

export interface BannerSlide {
  id: string;
  title: string;
  subtitle: string;
  imageSrc: string;
  alt: string;
}

export interface VipPlan {
  id: string;
  tier: string;
  level: number;
  label: string;
  investmentEtb: number;
  dailyIncomeEtb: number;
  cycleDays: number;
}

export interface WelfarePlan {
  id: string;
  name: string;
  investmentEtb: number;
  dailyAmountEtb: number;
  durationDays: number;
}

export interface WelfareEnrollmentRecord {
  id: string;
  planId: string;
  planName: string;
  investmentEtb: number;
  dailyAmountEtb: number;
  durationDays: number;
  claimedDays: number;
  accumulatedEtb: number;
  startedAt: string;
  startedAtMs: number;
  maturesAtMs: number;
  lastClaimAtMs: number | null;
  status: 'Active' | 'Completed';
  releasedAt?: string | null;
}

export interface PurchasedPlanRecord {
  id: string;
  planId: string;
  tier: string;
  investmentEtb: number;
  dailyIncomeEtb: number;
  cycleDays: number;
  claimedDays: number;
  purchaseDate: string;
  nextCycleAt: number;
  expiresAtMs: number;
  status: string;
}

export interface ActivityHistoryEntry {
  id: string;
  action: string;
  planTier: string;
  status: string;
  timestamp: string;
}

export interface TeamMember {
  id: string;
  name: string;
  phone: string;
  registeredAt: string;
  tier: string;
  level: 1 | 2 | 3;
  invitedBy: string;
}

export interface PaymentMethodConfig {
  id: string;
  methodName: string;
  accountName: string;
  accountNumber: string;
  enabled: boolean;
}

export interface PaymentSettings {
  depositMethods: PaymentMethodConfig[];
  withdrawalMethods: PaymentMethodConfig[];
  withdrawalStartHour: number;
  withdrawalEndHour: number;
  enforceWithdrawalHours: boolean;
  withdrawalScheduleNote: string;
  minWithdrawalEtb: number;
  minRechargeEtb: number;
  withdrawalFeePercent: number;
  registrationBonusEtb: number;
  dailyCheckInEtb: number;
  level1CommissionPercent: number;
  level2CommissionPercent: number;
  level3CommissionPercent: number;
  commissionBase: 'none' | 'verified_deposit';
  updatedAt: string;
}

export interface DepositRequestItem {
  id: string;
  userId?: string;
  customerName?: string;
  customerPhone?: string;
  amountEtb: number;
  referenceCode: string;
  paymentMethodName: string;
  accountName: string;
  accountNumber: string;
  receiptFilename: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  rejectionReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

export interface WithdrawalRequestItem {
  id: string;
  userId?: string;
  customerName?: string;
  customerPhone?: string;
  amountEtb: number;
  feeEtb: number;
  netAmountEtb: number;
  paymentMethodName: string;
  customerAccountName: string;
  customerAccountNumber: string;
  status: 'Pending' | 'Approved' | 'Processed' | 'Rejected';
  rejectionReason?: string | null;
  reviewedBy?: string | null;
  processedAt?: string | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  imageFilename?: string | null;
  type: string;
  isRead: boolean;
  createdAt: string;
}

export interface FeedbackItem {
  id: string;
  userId?: string;
  customerName?: string;
  customerPhone?: string;
  category: 'General Inquiry' | 'Account Issue' | 'Technical Feedback' | 'Complaint';
  subject: string;
  message: string;
  status: 'Unread' | 'Read' | 'Resolved';
  adminReply?: string | null;
  repliedAt?: string | null;
  createdAt: string;
}

export interface BroadcastItem {
  id: string;
  title: string;
  message: string;
  imageFilename?: string | null;
  targetUserId?: string | null;
  targetCustomerName?: string | null;
  createdBy: string;
  createdAt: string;
}

export type AdminNotificationEvent =
  | 'vip_purchase'
  | 'welfare_purchase'
  | 'deposit_request'
  | 'withdrawal_request';

export interface AdminNotificationItem {
  id: string;
  eventType: AdminNotificationEvent;
  title: string;
  message: string;
  referenceId: string;
  customerId: string | null;
  customerName: string;
  amountEtb: number;
  targetSection: 'customers' | 'deposits' | 'withdrawals';
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  details?: string | null;
  timestamp: string;
}

export interface CustomerProfilePayload {
  user: CustomerAccount;
  purchasedPlans: PurchasedPlanRecord[];
  welfareEnrollments: WelfareEnrollmentRecord[];
  checkInHistory: CheckInHistoryItem[];
  deposits: DepositRequestItem[];
  withdrawals: WithdrawalRequestItem[];
  notifications: NotificationItem[];
  activeBroadcast: BroadcastItem | null;
  feedbackMessages: FeedbackItem[];
  activities: ActivityHistoryEntry[];
  teamMembers: TeamMember[];
  paymentSettings: PaymentSettings;
  vipPlans: VipPlan[];
  welfarePlans?: WelfarePlan[];
}

export interface GiftCodeItem {
  code: string;
  amountEtb: number;
  maxRedemptions: number;
  redemptionCount: number;
  status: 'Active' | 'Revoked' | 'Exhausted';
  expiresAt?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AdminOverviewData {
  totalCustomers: number;
  activeCustomers: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
  unreadFeedback: number;
  totalBroadcasts: number;
  recentAuditLogs: AuditLogEntry[];
}

export interface AdminCustomerSummary {
  id: string;
  name: string;
  phone: string;
  status: CustomerStatus;
  invitationCode: string;
  invitedByCode?: string | null;
  registeredAt: string;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankMethod?: string | null;
}

export interface AdminCustomerDetailPayload {
  customer: AdminCustomerSummary & {
    termsAccepted: boolean;
    inviter: {
      id: string;
      name: string;
      phone: string;
      invitationCode: string;
    } | null;
  };
  deposits: {
    id: string;
    amountEtb: number;
    referenceCode: string;
    paymentMethodName: string;
    status: string;
    rejectionReason?: string | null;
    createdAt: string;
  }[];
  withdrawals: {
    id: string;
    amountEtb: number;
    feeEtb: number;
    netAmountEtb: number;
    paymentMethodName: string;
    accountNumber: string;
    status: string;
    rejectionReason?: string | null;
    createdAt: string;
    processedAt?: string | null;
  }[];
  purchasedPlans: {
    id: string;
    tier: string;
    investmentEtb: number;
    dailyIncomeEtb: number;
    cycleDays: number;
    purchaseDate: string;
    status: string;
  }[];
  checkInHistory: CheckInHistoryItem[];
  feedback: FeedbackItem[];
  activities: ActivityHistoryEntry[];
  team: TeamMember[];
}

export type CustomerTab = 'home' | 'purchased' | 'team' | 'me';

export type AdminSection =
  | 'overview'
  | 'customers'
  | 'deposits'
  | 'withdrawals'
  | 'feedback'
  | 'broadcasts'
  | 'payment_settings'
  | 'rewards'
  | 'audit';

export type ActiveModal =
  | null
  | { type: 'recharge' }
  | { type: 'withdraw' }
  | { type: 'giftcode' }
  | { type: 'support' }
  | { type: 'notifications' }
  | { type: 'terms' }
  | { type: 'about' }
  | { type: 'plan'; plan: VipPlan }
  | { type: 'welfare'; plan: WelfarePlan };
