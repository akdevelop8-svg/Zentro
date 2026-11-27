import React, { useEffect, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarCheck,
  Check,
  ChevronRight,
  Clock,
  FileText,
  Gift,
  Headphones,
  Info,
  Landmark,
  LogOut,
  Phone,
  Receipt,
  Users,
  Wallet,
} from 'lucide-react';
import { FINANCIAL_FEATURES_ENABLED } from '../services/api';
import {
  ActiveModal,
  BankAccountInfo,
  CheckInHistoryItem,
  CustomerAccount,
  CustomerTab,
  DepositRequestItem,
  PaymentSettings,
  WithdrawalRequestItem,
} from '../types/zentro';
import {
  canRequestWithdrawal,
  getCheckInStatus,
  MAIN_ZENTRO_LOGO,
  validateBankAccount,
} from '../utils/zentroLogic';

interface MeViewProps {
  currentUser: CustomerAccount;
  purchasedCount: number;
  welfareVaultEtb: number;
  checkInHistory: CheckInHistoryItem[];
  deposits: DepositRequestItem[];
  withdrawals: WithdrawalRequestItem[];
  settings: PaymentSettings;
  onNavigateTab: (tab: CustomerTab) => void;
  onOpenModal: (modal: ActiveModal) => void;
  onDailyCheckIn: () => Promise<{ ok: boolean; message: string }>;
  onSaveBankAccount: (account: BankAccountInfo) => Promise<void>;
  onLogout: () => void;
}

export const MeView: React.FC<MeViewProps> = ({
  currentUser,
  purchasedCount,
  welfareVaultEtb,
  checkInHistory,
  deposits,
  withdrawals,
  settings,
  onNavigateTab,
  onOpenModal,
  onDailyCheckIn,
  onSaveBankAccount,
  onLogout,
}) => {
  const [activePanel, setActivePanel] = useState<
    'none' | 'transaction' | 'bank' | 'withdrawals' | 'recharges'
  >('none');

  const [avatarError, setAvatarError] = useState(false);

  // Daily check-in live clock
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [checkInMessage, setCheckInMessage] = useState<string | null>(null);
  const [checkInSubmitting, setCheckInSubmitting] = useState(false);

  const enabledWithdrawalMethods = settings.withdrawalMethods.filter((m) => m.enabled);
  const defaultMethod = enabledWithdrawalMethods[0]?.methodName || 'CBE';

  // Bank Account Management
  const [bankMethod, setBankMethod] = useState(
    currentUser.bankAccount?.method ?? defaultMethod
  );
  const [bankName, setBankName] = useState(currentUser.bankAccount?.accountName ?? '');
  const [bankNumber, setBankNumber] = useState(
    currentUser.bankAccount?.accountNumber ?? ''
  );
  const [bankError, setBankError] = useState<string | null>(null);
  const [bankSaved, setBankSaved] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setBankName(currentUser.bankAccount?.accountName ?? '');
    setBankNumber(currentUser.bankAccount?.accountNumber ?? '');
    setBankMethod(currentUser.bankAccount?.method ?? defaultMethod);
  }, [currentUser.bankAccount, defaultMethod]);

  const checkInStatus = getCheckInStatus(currentUser.lastCheckInAt, nowMs);
  const meetsWithdrawalReq = canRequestWithdrawal(purchasedCount);

  const handleClaimCheckIn = async () => {
    if (checkInSubmitting || !checkInStatus.canClaim) return;
    setCheckInSubmitting(true);
    setCheckInMessage(null);
    try {
      const res = await onDailyCheckIn();
      setNowMs(Date.now());
      setCheckInMessage(res.message);
    } finally {
      setCheckInSubmitting(false);
    }
  };

  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setBankError(null);
    setBankSaved(false);
    const res = validateBankAccount({
      accountName: bankName,
      accountNumber: bankNumber,
      method: bankMethod,
    });
    if (!res.ok) {
      setBankError(res.error);
      return;
    }
    setBankSaving(true);
    try {
      await onSaveBankAccount(res.account);
      setBankSaved(true);
      window.setTimeout(() => setBankSaved(false), 2500);
    } catch (err) {
      setBankError((err as Error).message);
    } finally {
      setBankSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Compact Customer Profile Card */}
      <section
        aria-label="Customer profile"
        className="relative overflow-hidden rounded-3xl border border-amber-300/90 bg-white p-4 sm:p-5 shadow-xs space-y-3.5"
      >
        <div
          aria-hidden="true"
          className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-300 via-yellow-500 to-amber-400"
        />
        <div className="flex items-center justify-between gap-3 pt-0.5">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="h-12 w-12 rounded-2xl overflow-hidden border border-amber-400 ring-2 ring-amber-200/60 bg-slate-950 shrink-0 flex items-center justify-center p-0.5">
              {!avatarError ? (
                <img
                  src={MAIN_ZENTRO_LOGO}
                  alt={`${currentUser.name} ZENTRO profile`}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                  className="h-full w-full object-contain object-center"
                />
              ) : (
                <span className="font-display text-xs font-bold text-amber-400">
                  ZENTRO
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-base sm:text-lg font-bold text-slate-950 truncate">
                {currentUser.name}
              </h1>
              <p className="inline-flex items-center gap-1 text-xs font-mono text-slate-600 truncate">
                <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                <span>{currentUser.phone}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={!FINANCIAL_FEATURES_ENABLED}
              onClick={() => onOpenModal({ type: 'recharge' })}
              className="min-h-[32px] sm:min-h-[36px] px-2.5 rounded-lg sm:rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-[11px] sm:text-xs font-semibold cursor-pointer transition-colors"
            >
              Recharge
            </button>
            <button
              type="button"
              disabled={!FINANCIAL_FEATURES_ENABLED}
              onClick={() => onOpenModal({ type: 'withdraw' })}
              className="min-h-[32px] sm:min-h-[36px] px-2.5 rounded-lg sm:rounded-xl border border-blue-700 bg-white hover:bg-blue-50 text-blue-800 text-[11px] sm:text-xs font-semibold cursor-pointer transition-colors"
            >
              Withdraw
            </button>
          </div>
        </div>

        <div className="space-y-2.5 pt-2.5 border-t border-amber-100 text-xs">
          <div className="rounded-2xl border border-amber-300 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white px-4 py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="h-11 w-11 rounded-xl bg-white/10 border border-amber-300/60 text-amber-300 flex items-center justify-center shrink-0">
                <Wallet className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                  Total Balance
                </span>
                <span className="block font-mono tabular-nums font-extrabold text-white text-2xl sm:text-3xl leading-tight truncate">
                  {currentUser.walletBalanceEtb.toLocaleString()} ETB
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2">
              <span className="text-slate-600 block">Purchased Plans</span>
              <span className="font-mono tabular-nums font-bold text-amber-800 text-sm">
                {purchasedCount}
              </span>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2">
              <span className="text-blue-900 block">Welfare Vault (Locked)</span>
              <span className="font-mono tabular-nums font-bold text-blue-900 text-sm">
                {welfareVaultEtb.toLocaleString()} ETB
              </span>
            </div>
          </div>
        </div>
      </section>

      {FINANCIAL_FEATURES_ENABLED && (
      <section
        aria-label="Daily Check-in"
        className="rounded-2xl border border-amber-200 bg-white p-4 shadow-xs space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <CalendarCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-sm font-bold text-slate-950">
                Daily Check-in
              </h2>
              <p className="text-[11px] text-slate-600">
                Reward: {settings.dailyCheckInEtb} ETB every 24 hours
              </p>
            </div>
          </div>

          {checkInStatus.canClaim ? (
            <button
              type="button"
              disabled={checkInSubmitting}
              onClick={handleClaimCheckIn}
              className="min-h-[40px] px-3.5 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              {checkInSubmitting
                ? 'Claiming...'
                : `Daily Check-in (+${settings.dailyCheckInEtb} ETB)`}
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
              <Clock className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="font-mono tabular-nums text-sm font-bold text-blue-800">
                {checkInStatus.formattedRemaining}
              </span>
            </div>
          )}
        </div>

        {!checkInStatus.canClaim && (
          <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
            <span className="text-slate-600">Next claim available in</span>
            <span className="font-mono tabular-nums font-semibold text-amber-800">
              {checkInStatus.formattedRemaining}
            </span>
          </div>
        )}

        {checkInMessage && (
          <p role="status" className="text-[11px] font-medium text-emerald-700">
            {checkInMessage}
          </p>
        )}

        <div className="pt-2 border-t border-slate-100 space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-700">Check-in History</p>
          {checkInHistory.length === 0 ? (
            <p className="text-[11px] text-slate-500">No check-in claims yet.</p>
          ) : (
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {checkInHistory.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between text-[11px] text-slate-700 bg-slate-50 rounded-lg px-2.5 py-1.5"
                >
                  <span className="font-mono tabular-nums">{item.timestamp}</span>
                  <span className="font-mono font-semibold text-amber-700">
                    +{item.rewardEtb} ETB
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>      )}

      {/* Me Menu */}
      <section
        aria-label="Account menu"
        className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden"
      >
        {/* Transaction Summary (Total deposit, Total withdraw, Total commission) */}
        <button
          type="button"
          onClick={() =>
            setActivePanel(activePanel === 'transaction' ? 'none' : 'transaction')
          }
          className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer text-left"
        >
          <span className="flex items-center gap-3">
            <Receipt className="h-5 w-5 text-amber-600" />
            <span>
              <span className="block text-sm font-semibold text-slate-950">
                Transaction
              </span>
              <span className="block text-[11px] text-slate-500">
                Total deposit, withdraw &amp; commission
              </span>
            </span>
          </span>
          <ChevronRight
            className={`h-4 w-4 text-slate-400 transition-transform ${
              activePanel === 'transaction' ? 'rotate-90' : ''
            }`}
          />
        </button>

        {activePanel === 'transaction' && (
          <div className="p-4 bg-slate-50/70 space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                <span className="block text-[11px] text-slate-500">Total deposit</span>
                <span className="font-mono tabular-nums font-bold text-slate-950 text-xs sm:text-sm">
                  {currentUser.totalDepositEtb.toLocaleString()} ETB
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                <span className="block text-[11px] text-slate-500">Total withdraw</span>
                <span className="font-mono tabular-nums font-bold text-blue-800 text-xs sm:text-sm">
                  {currentUser.totalWithdrawEtb.toLocaleString()} ETB
                </span>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-2.5">
                <span className="block text-[11px] text-amber-800">Total commission</span>
                <span className="font-mono tabular-nums font-bold text-amber-900 text-xs sm:text-sm">
                  {currentUser.totalCommissionEtb.toLocaleString()} ETB
                </span>
              </div>
            </div>
          </div>
        )}

        {FINANCIAL_FEATURES_ENABLED && (
          <>
        {/* Bank Account Management */}
        <button
          type="button"
          onClick={() => setActivePanel(activePanel === 'bank' ? 'none' : 'bank')}
          className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer text-left"
        >
          <span className="flex items-center gap-3">
            <Landmark className="h-5 w-5 text-blue-700" />
            <span>
              <span className="block text-sm font-semibold text-slate-950">
                Bank Account Management
              </span>
              <span className="block text-[11px] text-slate-500">
                {currentUser.bankAccount
                  ? `${currentUser.bankAccount.method} · ${currentUser.bankAccount.accountNumber}`
                  : 'Configure withdrawal bank account'}
              </span>
            </span>
          </span>
          <ChevronRight
            className={`h-4 w-4 text-slate-400 transition-transform ${
              activePanel === 'bank' ? 'rotate-90' : ''
            }`}
          />
        </button>

        {activePanel === 'bank' && (
          <form onSubmit={handleSaveBank} className="p-4 bg-slate-50/70 space-y-3">
            <div>
              <label
                htmlFor="bank-method"
                className="block text-xs font-semibold text-slate-800 mb-1"
              >
                Withdrawal Method
              </label>
              <select
                id="bank-method"
                value={bankMethod}
                onChange={(e) => setBankMethod(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800"
              >
                {enabledWithdrawalMethods.length > 0 ? (
                  enabledWithdrawalMethods.map((m) => (
                    <option key={m.id} value={m.methodName}>
                      {m.methodName}
                    </option>
                  ))
                ) : (
                  <option value="CBE">CBE</option>
                )}
              </select>
            </div>

            <div>
              <label
                htmlFor="bank-account-name"
                className="block text-xs font-semibold text-slate-800 mb-1"
              >
                Account Name
              </label>
              <input
                id="bank-account-name"
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Account holder name"
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="bank-account-number"
                className="block text-xs font-semibold text-slate-800 mb-1"
              >
                Account Number
              </label>
              <input
                id="bank-account-number"
                type="text"
                inputMode="numeric"
                value={bankNumber}
                onChange={(e) => setBankNumber(e.target.value)}
                placeholder="1000XXXXXXXXX"
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-mono text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {bankError && (
              <p role="alert" className="text-xs font-medium text-red-700">
                {bankError}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={bankSaving}
                className="min-h-[42px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
              >
                {bankSaving ? 'Saving...' : 'Save Bank Account'}
              </button>
              {bankSaved && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <Check className="h-4 w-4" /> Saved
                </span>
              )}
            </div>
          </form>
        )}

          </>
        )}

        {/* Team Shortcut */}
        <button
          type="button"
          onClick={() => onNavigateTab('team')}
          className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer text-left"
        >
          <span className="flex items-center gap-3">
            <Users className="h-5 w-5 text-blue-700" />
            <span className="text-sm font-semibold text-slate-950">Team</span>
          </span>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </button>

        {/* Withdrawal History */}
        <button
          type="button"
          onClick={() =>
            setActivePanel(activePanel === 'withdrawals' ? 'none' : 'withdrawals')
          }
          className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer text-left"
        >
          <span className="flex items-center gap-3">
            <ArrowUpCircle className="h-5 w-5 text-blue-700" />
            <span>
              <span className="block text-sm font-semibold text-slate-950">
                Withdrawal History
              </span>
              <span className="block text-[11px] text-slate-500">
                Min: {settings.minWithdrawalEtb} ETB · Fee:{' '}
                {settings.withdrawalFeePercent}%
              </span>
            </span>
          </span>
          <ChevronRight
            className={`h-4 w-4 text-slate-400 transition-transform ${
              activePanel === 'withdrawals' ? 'rotate-90' : ''
            }`}
          />
        </button>

        {activePanel === 'withdrawals' && (
          <div className="p-4 bg-slate-50/70 space-y-2">
            <p className="text-[11px] font-medium text-slate-700">
              {meetsWithdrawalReq
                ? '1-plan requirement met'
                : 'Purchase at least 1 plan before first withdrawal'}
            </p>
            {withdrawals.length === 0 ? (
              <p className="text-xs text-slate-500">No withdrawal requests yet.</p>
            ) : (
              withdrawals.map((wd) => (
                <div
                  key={wd.id}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 space-y-1 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-950">
                        {wd.paymentMethodName} · {wd.customerAccountNumber}
                      </p>
                      <p className="text-slate-500 font-mono text-[11px]">
                        Net {wd.netAmountEtb.toLocaleString()} ETB · {wd.createdAt}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono tabular-nums font-bold text-slate-950">
                        {wd.amountEtb.toLocaleString()} ETB
                      </p>
                      <p
                        className={`text-[11px] font-semibold ${
                          wd.status === 'Processed' || wd.status === 'Approved'
                            ? 'text-emerald-700'
                            : wd.status === 'Rejected'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {wd.status}
                      </p>
                    </div>
                  </div>
                  {wd.rejectionReason && (
                    <p className="text-[11px] text-red-700">
                      Reason: {wd.rejectionReason}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Recharge / Deposit History */}
        <button
          type="button"
          onClick={() =>
            setActivePanel(activePanel === 'recharges' ? 'none' : 'recharges')
          }
          className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer text-left"
        >
          <span className="flex items-center gap-3">
            <ArrowDownCircle className="h-5 w-5 text-blue-700" />
            <span>
              <span className="block text-sm font-semibold text-slate-950">
                Recharge History
              </span>
              <span className="block text-[11px] text-slate-500">
                Min: {settings.minRechargeEtb} ETB
              </span>
            </span>
          </span>
          <ChevronRight
            className={`h-4 w-4 text-slate-400 transition-transform ${
              activePanel === 'recharges' ? 'rotate-90' : ''
            }`}
          />
        </button>

        {activePanel === 'recharges' && (
          <div className="p-4 bg-slate-50/70 space-y-2">
            {deposits.length === 0 ? (
              <p className="text-xs text-slate-500">No deposits submitted yet.</p>
            ) : (
              deposits.map((dep) => (
                <div
                  key={dep.id}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 space-y-1 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-950">
                        {dep.paymentMethodName}
                      </p>
                      <p className="text-slate-500 font-mono text-[11px]">
                        Ref {dep.referenceCode} · {dep.createdAt}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono tabular-nums font-bold text-slate-950">
                        {dep.amountEtb.toLocaleString()} ETB
                      </p>
                      <p
                        className={`text-[11px] font-semibold ${
                          dep.status === 'Approved'
                            ? 'text-emerald-700'
                            : dep.status === 'Rejected'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {dep.status}
                      </p>
                    </div>
                  </div>
                  {dep.rejectionReason && (
                    <p className="text-[11px] text-red-700">
                      Reason: {dep.rejectionReason}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Gift Code */}
        <button
          type="button"
          onClick={() => onOpenModal({ type: 'giftcode' })}
          className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer text-left"
        >
          <span className="flex items-center gap-3">
            <Gift className="h-5 w-5 text-amber-600" />
            <span className="text-sm font-semibold text-slate-950">Gift Code</span>
          </span>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </button>

        {/* Support */}
        <button
          type="button"
          onClick={() => onOpenModal({ type: 'support' })}
          className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer text-left"
        >
          <span className="flex items-center gap-3">
            <Headphones className="h-5 w-5 text-blue-700" />
            <span className="text-sm font-semibold text-slate-950">Support</span>
          </span>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </button>

        {/* About Us */}
        <button
          type="button"
          onClick={() => onOpenModal({ type: 'about' })}
          className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer text-left"
        >
          <span className="flex items-center gap-3">
            <Info className="h-5 w-5 text-blue-700" />
            <span className="text-sm font-semibold text-slate-950">About Us</span>
          </span>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </button>

        {/* Terms & Conditions */}
        <button
          type="button"
          onClick={() => onOpenModal({ type: 'terms' })}
          className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer text-left"
        >
          <span className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-blue-700" />
            <span className="text-sm font-semibold text-slate-950">
              Terms &amp; Conditions
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </button>
      </section>

      <button
        type="button"
        onClick={onLogout}
        className="w-full min-h-[46px] rounded-2xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
      >
        <LogOut className="h-4 w-4 text-slate-700" />
        <span>Logout</span>
      </button>
    </div>
  );
};
