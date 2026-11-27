import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Check,
  ClipboardList,
  CreditCard,
  Eye,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquareWarning,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import {
  apiAdminApproveDeposit,
  apiAdminApproveWithdrawal,
  apiAdminAuditLogs,
  apiAdminBroadcasts,
  apiAdminCustomerDetail,
  apiAdminCustomers,
  apiAdminDeposits,
  apiAdminFeedback,
  apiAdminGetPaymentSettings,
  apiAdminOverview,
  apiAdminProcessWithdrawal,
  apiAdminRejectDeposit,
  apiAdminRejectWithdrawal,
  apiAdminReplyFeedback,
  apiAdminSendBroadcast,
  apiAdminToggleCustomerStatus,
  apiAdminUpdateFeedbackStatus,
  apiAdminUpdatePaymentSettings,
  apiAdminWithdrawals,
  uploadImageUrl,
  BANK_TRANSFER_FEATURES_ENABLED,
} from '../services/api';
import {
  AdminCustomerDetailPayload,
  AdminCustomerSummary,
  AdminOverviewData,
  AdminSection,
  AuditLogEntry,
  AuthSessionUser,
  BroadcastItem,
  DepositRequestItem,
  FeedbackItem,
  PaymentMethodConfig,
  PaymentSettings,
  WithdrawalRequestItem,
} from '../types/zentro';
import { calculateTotalProfitEtb, fileToBase64DataUrl } from '../utils/zentroLogic';

interface AdminDashboardProps {
  currentUser: AuthSessionUser;
  onLogout: () => void;
}

const ADMIN_NAV: {
  id: AdminSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'overview', label: 'Dashboard Overview', icon: LayoutDashboard },
  { id: 'customers', label: 'Customer Management', icon: Users },
  { id: 'deposits', label: 'Deposit Requests', icon: ArrowDownCircle },
  { id: 'withdrawals', label: 'Withdrawal Requests', icon: ArrowUpCircle },
  { id: 'feedback', label: 'Feedback & Complaints', icon: MessageSquareWarning },
  { id: 'broadcasts', label: 'Broadcast Messages', icon: Megaphone },
  { id: 'payment_settings', label: 'Payment Settings', icon: CreditCard },
  { id: 'audit', label: 'Admin Activity / Audit Log', icon: ClipboardList },
];

const ACTIVE_ADMIN_NAV = ADMIN_NAV.filter(({ id }) =>
  BANK_TRANSFER_FEATURES_ENABLED || !['deposits', 'withdrawals', 'payment_settings'].includes(id)
);

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  onLogout,
}) => {
  const [section, setSection] = useState<AdminSection>('overview');
  const [bannerMsg, setBannerMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Data state
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [customers, setCustomers] = useState<AdminCustomerSummary[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Suspended'>('All');
  const [selectedCustomerDetail, setSelectedCustomerDetail] =
    useState<AdminCustomerDetailPayload | null>(null);

  const [deposits, setDeposits] = useState<DepositRequestItem[]>([]);
  const [depositFilter, setDepositFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [rejectDepositTarget, setRejectDepositTarget] = useState<DepositRequestItem | null>(null);
  const [rejectDepositReason, setRejectDepositReason] = useState('');

  const [withdrawals, setWithdrawals] = useState<WithdrawalRequestItem[]>([]);
  const [withdrawalFilter, setWithdrawalFilter] = useState<'All' | 'Pending' | 'Approved' | 'Processed' | 'Rejected'>('All');
  const [rejectWdTarget, setRejectWdTarget] = useState<WithdrawalRequestItem | null>(null);
  const [rejectWdReason, setRejectWdReason] = useState('');

  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
  const [feedbackReply, setFeedbackReply] = useState('');

  const [broadcasts, setBroadcasts] = useState<BroadcastItem[]>([]);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastImageDataUrl, setBroadcastImageDataUrl] = useState('');
  const [broadcastTargetUserId, setBroadcastTargetUserId] = useState('');

  const [paymentDraft, setPaymentDraft] = useState<PaymentSettings | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const showNotice = (ok: boolean, text: string) => {
    setBannerMsg({ ok, text });
    window.setTimeout(() => setBannerMsg(null), 4000);
  };

  const loadAllAdminData = useCallback(async () => {
    try {
      const [ov, custRes, fbRes, brdRes, audRes, financeRes] = await Promise.all([
        apiAdminOverview(),
        apiAdminCustomers(customerQuery, statusFilter),
        apiAdminFeedback(),
        apiAdminBroadcasts(),
        apiAdminAuditLogs(),
        BANK_TRANSFER_FEATURES_ENABLED
          ? Promise.all([apiAdminDeposits(), apiAdminWithdrawals(), apiAdminGetPaymentSettings()])
          : Promise.resolve(null),
      ]);
      setOverview(ov);
      setCustomers(custRes.customers);
      setDeposits(financeRes?.[0].deposits ?? []);
      setWithdrawals(financeRes?.[1].withdrawals ?? []);
      setFeedbackList(fbRes.feedback);
      setBroadcasts(brdRes.broadcasts);
      setPaymentDraft(financeRes?.[2] ?? null);
      setAuditLogs(audRes.auditLogs);
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  }, [customerQuery, statusFilter]);

  useEffect(() => {
    loadAllAdminData();
  }, [loadAllAdminData]);

  // Customer handlers
  const handleOpenCustomerDetail = async (id: string) => {
    try {
      const detail = await apiAdminCustomerDetail(id);
      setSelectedCustomerDetail(detail);
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  const handleToggleCustomerStatus = async (cust: AdminCustomerSummary) => {
    const nextStatus = cust.status === 'Active' ? 'Suspended' : 'Active';
    try {
      await apiAdminToggleCustomerStatus(cust.id, nextStatus);
      showNotice(true, `${cust.name} set to ${nextStatus}.`);
      await loadAllAdminData();
      if (selectedCustomerDetail?.customer.id === cust.id) {
        const updated = await apiAdminCustomerDetail(cust.id);
        setSelectedCustomerDetail(updated);
      }
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  // Deposit handlers
  const handleApproveDeposit = async (dep: DepositRequestItem) => {
    try {
      await apiAdminApproveDeposit(dep.id);
      showNotice(true, `Deposit of ${dep.amountEtb.toLocaleString()} ETB approved.`);
      await loadAllAdminData();
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  const handleRejectDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectDepositTarget) return;
    try {
      await apiAdminRejectDeposit(rejectDepositTarget.id, rejectDepositReason.trim());
      setRejectDepositTarget(null);
      setRejectDepositReason('');
      showNotice(true, 'Deposit rejected and customer notified.');
      await loadAllAdminData();
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  // Withdrawal handlers
  const handleApproveWithdrawal = async (wd: WithdrawalRequestItem) => {
    try {
      await apiAdminApproveWithdrawal(wd.id);
      showNotice(true, 'Withdrawal approved.');
      await loadAllAdminData();
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  const handleProcessWithdrawal = async (wd: WithdrawalRequestItem) => {
    try {
      await apiAdminProcessWithdrawal(wd.id);
      showNotice(true, 'Withdrawal marked as processed.');
      await loadAllAdminData();
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  const handleRejectWithdrawalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectWdTarget) return;
    try {
      await apiAdminRejectWithdrawal(rejectWdTarget.id, rejectWdReason.trim());
      setRejectWdTarget(null);
      setRejectWdReason('');
      showNotice(true, 'Withdrawal rejected, balance refunded, and customer notified.');
      await loadAllAdminData();
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  // Feedback handlers
  const handleOpenFeedback = async (fb: FeedbackItem) => {
    setSelectedFeedback(fb);
    setFeedbackReply(fb.adminReply ?? '');
    if (fb.status === 'Unread') {
      try {
        await apiAdminUpdateFeedbackStatus(fb.id, 'Read');
        await loadAllAdminData();
      } catch {
        // ignore
      }
    }
  };

  const handleMarkFeedbackStatus = async (fbId: string, status: 'Read' | 'Resolved') => {
    try {
      await apiAdminUpdateFeedbackStatus(fbId, status);
      showNotice(true, `Message marked ${status}.`);
      await loadAllAdminData();
      if (selectedFeedback?.id === fbId) {
        setSelectedFeedback((prev) => (prev ? { ...prev, status } : null));
      }
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  const handleReplyFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFeedback) return;
    try {
      await apiAdminReplyFeedback(selectedFeedback.id, feedbackReply.trim());
      showNotice(true, 'Reply sent and customer notified.');
      setSelectedFeedback(null);
      setFeedbackReply('');
      await loadAllAdminData();
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  // Broadcast handlers
  const handleBroadcastImageSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToBase64DataUrl(file);
      setBroadcastImageDataUrl(dataUrl);
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiAdminSendBroadcast({
        title: broadcastTitle.trim(),
        message: broadcastMsg.trim(),
        imageDataUrl: broadcastImageDataUrl || undefined,
        targetUserId: broadcastTargetUserId || undefined,
      });
      setBroadcastTitle('');
      setBroadcastMsg('');
      setBroadcastImageDataUrl('');
      setBroadcastTargetUserId('');
      showNotice(true, 'Broadcast sent and delivered to customer notifications.');
      await loadAllAdminData();
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  // Payment settings handlers
  const updateMethodList = (
    kind: 'depositMethods' | 'withdrawalMethods',
    idx: number,
    patch: Partial<PaymentMethodConfig>
  ) => {
    if (!paymentDraft) return;
    const nextList = paymentDraft[kind].map((m, i) =>
      i === idx ? { ...m, ...patch } : m
    );
    setPaymentDraft({ ...paymentDraft, [kind]: nextList });
  };

  const addMethodRow = (kind: 'depositMethods' | 'withdrawalMethods') => {
    if (!paymentDraft) return;
    const newRow: PaymentMethodConfig = {
      id: `${kind === 'depositMethods' ? 'dep' : 'wd'}-${Date.now()}`,
      methodName: '',
      accountName: '',
      accountNumber: '',
      enabled: true,
    };
    setPaymentDraft({
      ...paymentDraft,
      [kind]: [...paymentDraft[kind], newRow],
    });
  };

  const removeMethodRow = (
    kind: 'depositMethods' | 'withdrawalMethods',
    idx: number
  ) => {
    if (!paymentDraft || paymentDraft[kind].length <= 1) return;
    setPaymentDraft({
      ...paymentDraft,
      [kind]: paymentDraft[kind].filter((_, i) => i !== idx),
    });
  };

  const handleSavePaymentSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentDraft) return;
    try {
      const saved = await apiAdminUpdatePaymentSettings(paymentDraft);
      setPaymentDraft(saved);
      showNotice(true, 'Payment settings saved and logged.');
      await loadAllAdminData();
    } catch (err) {
      showNotice(false, (err as Error).message);
    }
  };

  const visibleDeposits = deposits.filter((d) =>
    depositFilter === 'All' ? true : d.status === depositFilter
  );
  const visibleWithdrawals = withdrawals.filter((w) =>
    withdrawalFilter === 'All' ? true : w.status === withdrawalFilter
  );

  return (
    <div className="min-h-screen bg-white text-slate-950 flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-amber-200/80 px-4 sm:px-6 py-3">
        <div className="mx-auto max-w-7xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo size="sm" />
            <div className="hidden sm:block">
              <span className="font-display text-sm font-bold text-slate-950">
                ZENTRO Admin Console
              </span>
              <span className="block text-[11px] text-amber-700 font-medium">
                Role-Based Access · {currentUser.name}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-950 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            <LogOut className="h-4 w-4 text-slate-600" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Mobile Navigation Tabs */}
      <nav
        aria-label="Admin sections"
        className="lg:hidden border-b border-slate-200 bg-white px-4 py-2 overflow-x-auto no-scrollbar"
      >
        <div className="flex items-center gap-1.5 min-w-max">
          {ACTIVE_ADMIN_NAV.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id ? 'page' : undefined}
              className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                section === id
                  ? 'bg-blue-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Workspace */}
      <div className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block lg:col-span-3">
          <nav
            aria-label="Admin sidebar navigation"
            className="rounded-2xl border border-slate-200 bg-white p-2 space-y-1 sticky top-24"
          >
            {ACTIVE_ADMIN_NAV.map(({ id, label, icon: Icon }) => {
              const active = section === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSection(id)}
                  aria-current={active ? 'page' : undefined}
                  className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-colors cursor-pointer text-left ${
                    active
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-950'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? 'text-amber-300' : 'text-slate-500'
                    }`}
                  />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Active Section */}
        <main className="lg:col-span-9 space-y-6 min-w-0">
          {bannerMsg && (
            <div
              role="status"
              className={`rounded-2xl border px-4 py-3 text-xs font-semibold ${
                bannerMsg.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {bannerMsg.text}
            </div>
          )}

          {/* 1. DASHBOARD OVERVIEW */}
          {section === 'overview' && (
            <section className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-950">
                  Dashboard Overview
                </h1>
                <p className="text-xs sm:text-sm text-slate-600">
                  Platform operations summary
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs text-slate-600">Total Customers</p>
                  <p className="font-mono tabular-nums text-2xl font-bold text-slate-950 mt-1">
                    {overview?.totalCustomers ?? 0}
                  </p>
                </div>
                {BANK_TRANSFER_FEATURES_ENABLED && (
                  <>
                    <div className="rounded-2xl border border-amber-200 bg-white p-4">
                      <p className="text-xs text-slate-600">Pending Deposits</p>
                      <p className="font-mono tabular-nums text-2xl font-bold text-blue-800 mt-1">
                        {overview?.pendingDeposits ?? 0}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-white p-4">
                      <p className="text-xs text-slate-600">Pending Withdrawals</p>
                      <p className="font-mono tabular-nums text-2xl font-bold text-amber-600 mt-1">
                        {overview?.pendingWithdrawals ?? 0}
                      </p>
                    </div>
                  </>
                )}
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs text-slate-600">Unread Feedback</p>
                  <p className="font-mono tabular-nums text-2xl font-bold text-slate-950 mt-1">
                    {overview?.unreadFeedback ?? 0}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {BANK_TRANSFER_FEATURES_ENABLED && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-base font-bold text-slate-950">
                        Pending Requests
                      </h2>
                      <button
                        type="button"
                        onClick={() => setSection('deposits')}
                        className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                      >
                        Review deposits
                      </button>
                    </div>
                    <div className="space-y-2 text-xs">
                      {deposits
                        .filter((d) => d.status === 'Pending')
                        .slice(0, 3)
                        .map((d) => (
                          <div
                            key={d.id}
                            className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 flex items-center justify-between"
                          >
                            <span>
                              <strong>{d.customerName}</strong> ({d.customerPhone})
                            </span>
                            <span className="font-mono font-bold text-blue-800">
                              +{d.amountEtb.toLocaleString()} ETB
                            </span>
                          </div>
                        ))}
                      {deposits.filter((d) => d.status === 'Pending').length === 0 && (
                        <p className="text-slate-500">No pending deposit requests.</p>
                      )}
                    </div>
                  </div>
  
                  )}

                <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold text-slate-950">
                      Recent Audit Logs
                    </h2>
                    <button
                      type="button"
                      onClick={() => setSection('audit')}
                      className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      View all
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {(overview?.recentAuditLogs ?? []).slice(0, 4).map((log) => (
                      <div key={log.id} className="py-2">
                        <p className="text-xs font-semibold text-slate-950">{log.action}</p>
                        <p className="text-[11px] text-slate-500">
                          {log.target} · <span className="font-mono">{log.timestamp}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 2. CUSTOMER MANAGEMENT (Zero wallet balances, zero passwords) */}
          {section === 'customers' && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-bold text-slate-950">
                    Customer Management
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Search customers by phone or name, view complete profiles, and manage account status
                  </p>
                </div>
                {!BANK_TRANSFER_FEATURES_ENABLED && <span className="text-[11px] font-medium text-amber-800">Financial controls paused until release</span>}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    placeholder="Search phone number, name, or invitation code..."
                    aria-label="Search customers"
                    className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100">
                  {(['All', 'Active', 'Suspended'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatusFilter(status)}
                      className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        statusFilter === status
                          ? 'bg-white text-blue-800 shadow-xs'
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Phone Number</th>
                      <th className="py-3 px-4">Invitation Code</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {customers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          No matching customer accounts found.
                        </td>
                      </tr>
                    ) : (
                      customers.map((cust) => (
                        <tr key={cust.id} className="hover:bg-slate-50/60">
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-950">{cust.name}</p>
                            <p className="text-[11px] text-slate-500">
                              Joined {cust.registeredAt}
                            </p>
                          </td>
                          <td className="py-3 px-4 font-mono">{cust.phone}</td>
                          <td className="py-3 px-4 font-mono">{cust.invitationCode}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`font-semibold ${
                                cust.status === 'Active'
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              }`}
                            >
                              {cust.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => handleOpenCustomerDetail(cust.id)}
                              className="min-h-[34px] px-3 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>Details</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleCustomerStatus(cust)}
                              className="min-h-[34px] px-3 rounded-lg border border-slate-200 hover:border-blue-600 text-xs font-semibold text-slate-900 cursor-pointer"
                            >
                              {cust.status === 'Active' ? 'Suspend' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 3. DEPOSIT REQUESTS */}
          {BANK_TRANSFER_FEATURES_ENABLED && section === 'deposits' && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-bold text-slate-950">
                    Deposit Requests
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Inspect payment receipts and approve or reject customer deposits
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100">
                  {(['All', 'Pending', 'Approved', 'Rejected'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setDepositFilter(st)}
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                        depositFilter === st
                          ? 'bg-white text-blue-800 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {visibleDeposits.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                    No deposit requests found.
                  </div>
                ) : (
                  visibleDeposits.map((dep) => {
                    const receiptUrl = uploadImageUrl(dep.receiptFilename);
                    return (
                      <article
                        key={dep.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-bold text-slate-950">
                                {dep.customerName}
                              </span>
                              <span className="font-mono text-slate-600">
                                {dep.customerPhone}
                              </span>
                              <span className="text-slate-400">·</span>
                              <span className="font-mono text-slate-500">
                                {dep.createdAt}
                              </span>
                            </div>
                            <p className="text-sm font-mono font-bold text-blue-800">
                              {dep.amountEtb.toLocaleString()} ETB · {dep.paymentMethodName}
                            </p>
                            <p className="text-xs text-slate-600">
                              Reference:{' '}
                              <span className="font-mono font-semibold text-slate-950">
                                {dep.referenceCode}
                              </span>{' '}
                              · To: {dep.accountName} ({dep.accountNumber})
                            </p>
                            {dep.rejectionReason && (
                              <p className="text-xs text-red-700 font-medium">
                                Rejection Reason: {dep.rejectionReason}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                                dep.status === 'Approved'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : dep.status === 'Rejected'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-amber-50 text-amber-800'
                              }`}
                            >
                              {dep.status}
                            </span>
                            {receiptUrl && (
                              <button
                                type="button"
                                onClick={() => setReceiptPreviewUrl(receiptUrl)}
                                className="min-h-[36px] px-3 rounded-xl border border-slate-200 hover:border-blue-600 text-xs font-semibold text-slate-900 cursor-pointer"
                              >
                                View Receipt
                              </button>
                            )}
                          </div>
                        </div>

                        {dep.status === 'Pending' && (
                          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => handleApproveDeposit(dep)}
                              className="min-h-[38px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
                            >
                              Approve Deposit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectDepositTarget(dep);
                                setRejectDepositReason('');
                              }}
                              className="min-h-[38px] px-4 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold cursor-pointer"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {/* 4. WITHDRAWAL REQUESTS */}
          {BANK_TRANSFER_FEATURES_ENABLED && section === 'withdrawals' && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-bold text-slate-950">
                    Withdrawal Requests
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Review customer payout accounts, approve, mark processed, or reject with refund
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100">
                  {(['All', 'Pending', 'Approved', 'Processed', 'Rejected'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setWithdrawalFilter(st)}
                      className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
                        withdrawalFilter === st
                          ? 'bg-white text-blue-800 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {visibleWithdrawals.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                    No withdrawal requests found.
                  </div>
                ) : (
                  visibleWithdrawals.map((wd) => (
                    <article
                      key={wd.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-bold text-slate-950">
                              {wd.customerName}
                            </span>
                            <span className="font-mono text-slate-600">
                              {wd.customerPhone}
                            </span>
                            <span className="text-slate-400">·</span>
                            <span className="font-mono text-slate-500">
                              {wd.createdAt}
                            </span>
                          </div>
                          <p className="text-sm font-mono font-bold text-slate-950">
                            Requested: {wd.amountEtb.toLocaleString()} ETB · Fee:{' '}
                            {wd.feeEtb.toLocaleString()} ETB · Net:{' '}
                            <span className="text-blue-800">
                              {wd.netAmountEtb.toLocaleString()} ETB
                            </span>
                          </p>
                          <p className="text-xs text-slate-700">
                            Payout Account: <strong>{wd.paymentMethodName}</strong> ·{' '}
                            {wd.customerAccountName} (
                            <span className="font-mono font-semibold">
                              {wd.customerAccountNumber}
                            </span>
                            )
                          </p>
                          {wd.rejectionReason && (
                            <p className="text-xs text-red-700 font-medium">
                              Rejection Reason: {wd.rejectionReason}
                            </p>
                          )}
                        </div>

                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                            wd.status === 'Processed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : wd.status === 'Approved'
                              ? 'bg-blue-50 text-blue-800'
                              : wd.status === 'Rejected'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {wd.status}
                        </span>
                      </div>

                      {(wd.status === 'Pending' || wd.status === 'Approved') && (
                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                          {wd.status === 'Pending' && (
                            <button
                              type="button"
                              onClick={() => handleApproveWithdrawal(wd)}
                              className="min-h-[38px] px-4 rounded-xl border border-blue-700 bg-white hover:bg-blue-50 text-blue-800 text-xs font-semibold cursor-pointer"
                            >
                              Approve
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleProcessWithdrawal(wd)}
                            className="min-h-[38px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
                          >
                            Mark Processed / Completed
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectWdTarget(wd);
                              setRejectWdReason('');
                            }}
                            className="min-h-[38px] px-4 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold cursor-pointer"
                          >
                            Reject &amp; Refund
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          )}

          {/* 5. FEEDBACK & COMPLAINTS */}
          {section === 'feedback' && (
            <section className="space-y-4">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-950">
                  Feedback &amp; Complaints
                </h1>
                <p className="text-xs sm:text-sm text-slate-600">
                  Open customer messages, mark as Read or Resolved, and send direct replies
                </p>
              </div>

              <div className="space-y-3">
                {feedbackList.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                    No customer feedback or complaints yet.
                  </div>
                ) : (
                  feedbackList.map((fb) => (
                    <article
                      key={fb.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                            <span className="font-semibold text-blue-800">{fb.category}</span>
                            <span>·</span>
                            <span className="font-semibold text-slate-950">
                              {fb.customerName}
                            </span>
                            <span>·</span>
                            <span className="font-mono">{fb.customerPhone}</span>
                            <span>·</span>
                            <span className="font-mono">{fb.createdAt}</span>
                          </div>
                          <h2 className="font-display text-base font-bold text-slate-950 mt-1">
                            {fb.subject}
                          </h2>
                        </div>

                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                            fb.status === 'Resolved'
                              ? 'bg-emerald-50 text-emerald-700'
                              : fb.status === 'Read'
                              ? 'bg-blue-50 text-blue-800'
                              : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {fb.status}
                        </span>
                      </div>

                      <p className="text-xs sm:text-sm text-slate-700">{fb.message}</p>

                      {fb.adminReply && (
                        <p className="rounded-xl bg-amber-50/70 border border-amber-200 px-3 py-2 text-xs text-slate-900">
                          <strong className="text-amber-900">Reply: </strong>
                          {fb.adminReply}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => handleOpenFeedback(fb)}
                          className="min-h-[36px] px-3.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
                        >
                          Open &amp; Reply
                        </button>
                        {fb.status === 'Unread' && (
                          <button
                            type="button"
                            onClick={() => handleMarkFeedbackStatus(fb.id, 'Read')}
                            className="min-h-[36px] px-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
                          >
                            Mark Read
                          </button>
                        )}
                        {fb.status !== 'Resolved' && (
                          <button
                            type="button"
                            onClick={() => handleMarkFeedbackStatus(fb.id, 'Resolved')}
                            className="min-h-[36px] px-3.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 cursor-pointer"
                          >
                            Mark Resolved
                          </button>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}

          {/* 6. BROADCAST MESSAGES WITH IMAGE UPLOAD & LIVE PREVIEW */}
          {section === 'broadcasts' && (
            <section className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-950">
                  Broadcast Messages
                </h1>
                <p className="text-xs sm:text-sm text-slate-600">
                  Compose announcements with optional images, preview them, and send to all customers or a selected customer
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <form
                  onSubmit={handleSendBroadcast}
                  className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3.5"
                >
                  <h2 className="font-display text-base font-bold text-slate-950">
                    Compose Message
                  </h2>

                  <div>
                    <label
                      htmlFor="brd-target"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Recipient
                    </label>
                    <select
                      id="brd-target"
                      value={broadcastTargetUserId}
                      onChange={(e) => setBroadcastTargetUserId(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900"
                    >
                      <option value="">All Registered Customers</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.phone})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="brd-title"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Title
                    </label>
                    <input
                      id="brd-title"
                      type="text"
                      value={broadcastTitle}
                      onChange={(e) => setBroadcastTitle(e.target.value)}
                      placeholder="Announcement title"
                      className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm text-slate-950"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="brd-msg"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Message
                    </label>
                    <textarea
                      id="brd-msg"
                      rows={3}
                      value={broadcastMsg}
                      onChange={(e) => setBroadcastMsg(e.target.value)}
                      placeholder="Write your announcement..."
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm text-slate-950"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="brd-image"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Attach Image (Optional, PNG / JPEG / WebP)
                    </label>
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="brd-image"
                        className="flex-1 min-h-[42px] px-3.5 rounded-xl border border-dashed border-blue-400 bg-blue-50/40 hover:bg-blue-50 text-xs font-semibold text-blue-800 flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Upload className="h-4 w-4" />
                        <span>{broadcastImageDataUrl ? 'Change Image' : 'Upload Image'}</span>
                        <input
                          id="brd-image"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleBroadcastImageSelect}
                          className="sr-only"
                        />
                      </label>
                      {broadcastImageDataUrl && (
                        <button
                          type="button"
                          onClick={() => setBroadcastImageDataUrl('')}
                          className="min-h-[42px] px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full min-h-[44px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Send className="h-4 w-4" />
                    <span>
                      {broadcastTargetUserId
                        ? 'Send Direct Message'
                        : 'Broadcast to All Customers'}
                    </span>
                  </button>
                </form>

                {/* Live Announcement Preview */}
                <div className="rounded-2xl border border-amber-200 bg-amber-50/30 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold text-slate-950">
                      Customer Notification Preview
                    </h2>
                    <span className="text-[11px] font-semibold text-amber-800">
                      {broadcastTargetUserId ? 'Selected Customer' : 'All Customers'}
                    </span>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
                    <p className="text-sm font-bold text-slate-950">
                      {broadcastTitle.trim() || 'Announcement Title'}
                    </p>
                    <p className="text-xs text-slate-700 whitespace-pre-line">
                      {broadcastMsg.trim() ||
                        'Your announcement message preview will appear here.'}
                    </p>
                    {broadcastImageDataUrl && (
                      <img
                        src={broadcastImageDataUrl}
                        alt="Broadcast preview"
                        className="w-full max-h-52 rounded-xl object-contain border border-slate-200 bg-slate-50"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Previously Sent Announcements */}
              <div className="space-y-3">
                <h2 className="font-display text-base font-bold text-slate-950">
                  Sent Announcements
                </h2>
                {broadcasts.map((b) => {
                  const imgSrc = uploadImageUrl(b.imageFilename);
                  return (
                    <div
                      key={b.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-start justify-between gap-4"
                    >
                      <div className="space-y-1 flex-1 min-w-[220px]">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-slate-950">{b.title}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-slate-500">{b.createdAt}</span>
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                            {b.targetCustomerName
                              ? `Direct: ${b.targetCustomerName}`
                              : 'All Customers'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 whitespace-pre-line">
                          {b.message}
                        </p>
                      </div>
                      {imgSrc && (
                        <img
                          src={imgSrc}
                          alt={b.title}
                          className="h-20 w-28 rounded-xl object-cover border border-slate-200 shrink-0"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 7. PAYMENT SETTINGS */}
          {BANK_TRANSFER_FEATURES_ENABLED && section === 'payment_settings' && paymentDraft && (
            <section className="space-y-4">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-950">
                  Payment Settings
                </h1>
                <p className="text-xs sm:text-sm text-slate-600">
                  Configure deposit accounts, withdrawal methods, limits, and withdrawal processing time window
                </p>
              </div>

              <form onSubmit={handleSavePaymentSettings} className="space-y-5">
                {/* Deposit Methods */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold text-slate-950">
                      Deposit Payment Methods
                    </h2>
                    <button
                      type="button"
                      onClick={() => addMethodRow('depositMethods')}
                      className="min-h-[36px] px-3 rounded-xl border border-blue-700 text-xs font-semibold text-blue-800 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Deposit Method</span>
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {paymentDraft.depositMethods.map((m, idx) => (
                      <div
                        key={m.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center"
                      >
                        <input
                          type="text"
                          value={m.methodName}
                          onChange={(e) =>
                            updateMethodList('depositMethods', idx, {
                              methodName: e.target.value,
                            })
                          }
                          placeholder="Method (e.g. CBE)"
                          className="sm:col-span-3 min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold"
                        />
                        <input
                          type="text"
                          value={m.accountName}
                          onChange={(e) =>
                            updateMethodList('depositMethods', idx, {
                              accountName: e.target.value,
                            })
                          }
                          placeholder="Account Holder Name"
                          className="sm:col-span-4 min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs"
                        />
                        <input
                          type="text"
                          value={m.accountNumber}
                          onChange={(e) =>
                            updateMethodList('depositMethods', idx, {
                              accountNumber: e.target.value,
                            })
                          }
                          placeholder="Account Number"
                          className="sm:col-span-3 min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono"
                        />
                        <div className="sm:col-span-2 flex items-center justify-end gap-2">
                          <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={m.enabled}
                              onChange={(e) =>
                                updateMethodList('depositMethods', idx, {
                                  enabled: e.target.checked,
                                })
                              }
                              className="accent-blue-700"
                            />
                            <span>On</span>
                          </label>
                          {paymentDraft.depositMethods.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeMethodRow('depositMethods', idx)}
                              aria-label="Remove deposit method"
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Withdrawal Methods */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold text-slate-950">
                      Withdrawal Payment Methods
                    </h2>
                    <button
                      type="button"
                      onClick={() => addMethodRow('withdrawalMethods')}
                      className="min-h-[36px] px-3 rounded-xl border border-blue-700 text-xs font-semibold text-blue-800 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Withdrawal Method</span>
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {paymentDraft.withdrawalMethods.map((m, idx) => (
                      <div
                        key={m.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center"
                      >
                        <input
                          type="text"
                          value={m.methodName}
                          onChange={(e) =>
                            updateMethodList('withdrawalMethods', idx, {
                              methodName: e.target.value,
                            })
                          }
                          placeholder="Method (e.g. CBE)"
                          className="sm:col-span-3 min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold"
                        />
                        <input
                          type="text"
                          value={m.accountName}
                          onChange={(e) =>
                            updateMethodList('withdrawalMethods', idx, {
                              accountName: e.target.value,
                            })
                          }
                          placeholder="Account Label"
                          className="sm:col-span-4 min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs"
                        />
                        <input
                          type="text"
                          value={m.accountNumber}
                          onChange={(e) =>
                            updateMethodList('withdrawalMethods', idx, {
                              accountNumber: e.target.value,
                            })
                          }
                          placeholder="Payout Format / Note"
                          className="sm:col-span-3 min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs"
                        />
                        <div className="sm:col-span-2 flex items-center justify-end gap-2">
                          <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={m.enabled}
                              onChange={(e) =>
                                updateMethodList('withdrawalMethods', idx, {
                                  enabled: e.target.checked,
                                })
                              }
                              className="accent-blue-700"
                            />
                            <span>On</span>
                          </label>
                          {paymentDraft.withdrawalMethods.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeMethodRow('withdrawalMethods', idx)}
                              aria-label="Remove withdrawal method"
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Withdrawal Processing Time Schedule & Limits */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                  <h2 className="font-display text-base font-bold text-slate-950">
                    Limits &amp; Withdrawal Processing Schedule
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Min Deposit (ETB)
                      </label>
                      <input
                        type="number"
                        value={paymentDraft.minRechargeEtb}
                        onChange={(e) =>
                          setPaymentDraft({
                            ...paymentDraft,
                            minRechargeEtb: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Min Withdraw (ETB)
                      </label>
                      <input
                        type="number"
                        value={paymentDraft.minWithdrawalEtb}
                        onChange={(e) =>
                          setPaymentDraft({
                            ...paymentDraft,
                            minWithdrawalEtb: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Withdraw Fee (%)
                      </label>
                      <input
                        type="number"
                        value={paymentDraft.withdrawalFeePercent}
                        onChange={(e) =>
                          setPaymentDraft({
                            ...paymentDraft,
                            withdrawalFeePercent: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Start Hour (0–23)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={paymentDraft.withdrawalStartHour}
                        onChange={(e) =>
                          setPaymentDraft({
                            ...paymentDraft,
                            withdrawalStartHour: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        End Hour (0–23)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={paymentDraft.withdrawalEndHour}
                        onChange={(e) =>
                          setPaymentDraft({
                            ...paymentDraft,
                            withdrawalEndHour: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Withdrawal Schedule Notice
                    </label>
                    <input
                      type="text"
                      value={paymentDraft.withdrawalScheduleNote}
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          withdrawalScheduleNote: e.target.value,
                        })
                      }
                      className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={paymentDraft.enforceWithdrawalHours}
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          enforceWithdrawalHours: e.target.checked,
                        })
                      }
                      className="accent-blue-700"
                    />
                    <span>Enforce withdrawal time window on customer withdrawal requests</span>
                  </label>

                  <button
                    type="submit"
                    className="min-h-[44px] px-5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Check className="h-4 w-4" />
                    <span>Save Payment Settings</span>
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* 8. ADMIN ACTIVITY / AUDIT LOG */}
          {section === 'audit' && (
            <section className="space-y-4">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-950">
                  Admin Activity / Audit Log
                </h1>
                <p className="text-xs sm:text-sm text-slate-600">
                  Chronological audit trail of administrative changes
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[560px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Target</th>
                      <th className="py-3 px-4">Details</th>
                      <th className="py-3 px-4 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4 font-semibold text-slate-950">{log.actor}</td>
                        <td className="py-3 px-4 text-blue-800 font-medium">{log.action}</td>
                        <td className="py-3 px-4 text-slate-700">{log.target}</td>
                        <td className="py-3 px-4 text-slate-500">{log.details ?? '—'}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                          {log.timestamp}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* Customer Detail Modal (Zero wallet balances, zero passwords) */}
      {selectedCustomerDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedCustomerDetail(null);
          }}
        >
          <div className="w-full max-w-2xl rounded-3xl bg-white border border-slate-200 p-5 sm:p-6 shadow-xl max-h-[88vh] overflow-y-auto space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-950">
                  {selectedCustomerDetail.customer.name}
                </h2>
                <p className="text-xs font-mono text-slate-600">
                  {selectedCustomerDetail.customer.phone} · Code:{' '}
                  {selectedCustomerDetail.customer.invitationCode} · Status:{' '}
                  {selectedCustomerDetail.customer.status}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomerDetail(null)}
                aria-label="Close detail"
                className="min-h-[38px] min-w-[38px] rounded-xl border border-slate-200 flex items-center justify-center cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="block text-slate-500">Registered</span>
                <span className="font-mono font-semibold text-slate-950">
                  {selectedCustomerDetail.customer.registeredAt}
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="block text-slate-500">Invited By</span>
                <span className="font-semibold text-slate-950">
                  {selectedCustomerDetail.customer.inviter
                    ? `${selectedCustomerDetail.customer.inviter.name} (${selectedCustomerDetail.customer.inviter.invitationCode})`
                    : selectedCustomerDetail.customer.invitedByCode ?? 'Direct'}
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="block text-slate-500">Team (L1 / L2 / L3)</span>
                <span className="font-mono font-semibold text-blue-800">
                  {selectedCustomerDetail.team.filter((t) => t.level === 1).length} /{' '}
                  {selectedCustomerDetail.team.filter((t) => t.level === 2).length} /{' '}
                  {selectedCustomerDetail.team.filter((t) => t.level === 3).length}
                </span>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <h3 className="font-bold text-slate-950">
                Purchased Plans ({selectedCustomerDetail.purchasedPlans.length})
              </h3>
              {selectedCustomerDetail.purchasedPlans.length === 0 ? (
                <p className="text-slate-500">None</p>
              ) : (
                selectedCustomerDetail.purchasedPlans.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-slate-200 px-3 py-2 flex justify-between"
                  >
                    <span>
                      <strong>{p.tier}</strong> · {p.purchaseDate}
                    </span>
                    <span className="font-mono text-right">
                      <span className="block">{p.investmentEtb.toLocaleString()} ETB ({p.status})</span>
                      <span className="block text-[11px] text-slate-500">
                        Daily Profit: {p.dailyIncomeEtb.toLocaleString()} ETB × {p.cycleDays} days
                      </span>
                      <span className="block text-[11px] font-semibold text-emerald-700">
                        Total Profit: {calculateTotalProfitEtb(p.dailyIncomeEtb, p.cycleDays).toLocaleString()} ETB
                      </span>
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1.5">
                <h3 className="font-bold text-slate-950">
                  Deposit History ({selectedCustomerDetail.deposits.length})
                </h3>
                {selectedCustomerDetail.deposits.slice(0, 5).map((d) => (
                  <div
                    key={d.id}
                    className="rounded-xl border border-slate-200 px-3 py-2 flex justify-between"
                  >
                    <span className="font-mono">{d.referenceCode}</span>
                    <span className="font-mono">
                      {d.amountEtb.toLocaleString()} ETB · {d.status}
                    </span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <h3 className="font-bold text-slate-950">
                  Withdrawal History ({selectedCustomerDetail.withdrawals.length})
                </h3>
                {selectedCustomerDetail.withdrawals.slice(0, 5).map((w) => (
                  <div
                    key={w.id}
                    className="rounded-xl border border-slate-200 px-3 py-2 flex justify-between"
                  >
                    <span className="font-mono">{w.accountNumber}</span>
                    <span className="font-mono">
                      {w.amountEtb.toLocaleString()} ETB · {w.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              <h3 className="font-bold text-slate-950">
                Daily Check-in &amp; Activity Timestamps
              </h3>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {selectedCustomerDetail.checkInHistory.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-lg bg-amber-50/70 px-3 py-1.5 flex justify-between"
                  >
                    <span>Daily Check-in (+{c.rewardEtb} ETB)</span>
                    <span className="font-mono">{c.timestamp}</span>
                  </div>
                ))}
                {selectedCustomerDetail.activities.slice(0, 8).map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg bg-slate-50 px-3 py-1.5 flex justify-between"
                  >
                    <span>{a.action}</span>
                    <span className="font-mono text-slate-500">{a.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Image Inspection Modal */}
      {receiptPreviewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReceiptPreviewUrl(null);
          }}
        >
          <div className="max-w-lg w-full rounded-3xl bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-950">
                Payment Receipt
              </h3>
              <button
                type="button"
                onClick={() => setReceiptPreviewUrl(null)}
                className="p-2 rounded-xl border border-slate-200 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={receiptPreviewUrl}
              alt="Customer deposit receipt"
              className="w-full max-h-[70vh] object-contain rounded-xl bg-slate-50"
            />
          </div>
        </div>
      )}

      {/* Reject Deposit Modal */}
      {rejectDepositTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleRejectDepositSubmit}
            className="w-full max-w-md rounded-3xl bg-white p-5 space-y-3.5"
          >
            <h3 className="font-display text-base font-bold text-slate-950">
              Reject Deposit ({rejectDepositTarget.amountEtb.toLocaleString()} ETB)
            </h3>
            <textarea
              rows={3}
              required
              value={rejectDepositReason}
              onChange={(e) => setRejectDepositReason(e.target.value)}
              placeholder="Enter required rejection reason..."
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectDepositTarget(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
              >
                Confirm Reject
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reject Withdrawal Modal */}
      {rejectWdTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleRejectWithdrawalSubmit}
            className="w-full max-w-md rounded-3xl bg-white p-5 space-y-3.5"
          >
            <h3 className="font-display text-base font-bold text-slate-950">
              Reject &amp; Refund Withdrawal ({rejectWdTarget.amountEtb.toLocaleString()} ETB)
            </h3>
            <textarea
              rows={3}
              required
              value={rejectWdReason}
              onChange={(e) => setRejectWdReason(e.target.value)}
              placeholder="Enter required rejection reason..."
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectWdTarget(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
              >
                Confirm Reject &amp; Refund
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Feedback Reply Modal */}
      {selectedFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleReplyFeedbackSubmit}
            className="w-full max-w-lg rounded-3xl bg-white p-5 space-y-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-slate-950">
                  {selectedFeedback.subject}
                </h3>
                <p className="text-xs text-slate-600">
                  {selectedFeedback.customerName} ({selectedFeedback.customerPhone}) ·{' '}
                  {selectedFeedback.createdAt}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFeedback(null)}
                className="p-2 rounded-xl border border-slate-200 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
              {selectedFeedback.message}
            </div>

            <textarea
              rows={3}
              required
              value={feedbackReply}
              onChange={(e) => setFeedbackReply(e.target.value)}
              placeholder="Write reply to customer..."
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedFeedback(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
              >
                Send Reply &amp; Notify
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
