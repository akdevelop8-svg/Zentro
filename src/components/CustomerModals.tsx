import React, { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Clock,
  Crown,
  Gift,
  Lock,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { WELFARE_PLAN_IMAGES } from '../assets/planImages';
import {
  apiBuyVipPlan,
  apiBuyWelfarePlan,
  apiCreateDeposit,
  apiCreateWithdrawal,
  apiMarkNotificationsRead,
  apiSubmitSupport,
  apiVerifyGiftCode,
  uploadImageUrl,
  FINANCIAL_FEATURES_ENABLED,
} from '../services/api';
import {
  ActiveModal,
  CustomerAccount,
  FeedbackItem,
  NotificationItem,
  PaymentSettings,
} from '../types/zentro';
import {
  calculateWithdrawalPreview,
  canRequestWithdrawal,
  fileToBase64DataUrl,
} from '../utils/zentroLogic';
import { RegistrationTermsContent } from './RegistrationTermsView';

interface CustomerModalsProps {
  modal: ActiveModal;
  currentUser: CustomerAccount;
  purchasedCount: number;
  settings: PaymentSettings;
  notifications: NotificationItem[];
  feedbackMessages: FeedbackItem[];
  onClose: () => void;
  onRefreshMe: () => Promise<void>;
}

export const CustomerModals: React.FC<CustomerModalsProps> = ({
  modal,
  currentUser,
  purchasedCount,
  settings,
  notifications,
  feedbackMessages,
  onClose,
  onRefreshMe,
}) => {
  const enabledDepositMethods = settings.depositMethods.filter((m) => m.enabled);
  const enabledWithdrawalMethods = settings.withdrawalMethods.filter((m) => m.enabled);

  // Deposit form state
  const [depMethodId, setDepMethodId] = useState(
    enabledDepositMethods[0]?.id ?? ''
  );
  const [depAmount, setDepAmount] = useState(String(settings.minRechargeEtb));
  const [depRef, setDepRef] = useState('');
  const [depReceiptDataUrl, setDepReceiptDataUrl] = useState('');
  const [depError, setDepError] = useState<string | null>(null);
  const [depSuccess, setDepSuccess] = useState(false);
  const [depLoading, setDepLoading] = useState(false);

  // Withdrawal form state
  const [wdMethodId, setWdMethodId] = useState(
    enabledWithdrawalMethods[0]?.id ?? ''
  );
  const [wdAmount, setWdAmount] = useState(String(settings.minWithdrawalEtb));
  const [wdError, setWdError] = useState<string | null>(null);
  const [wdSuccess, setWdSuccess] = useState(false);
  const [wdLoading, setWdLoading] = useState(false);

  // Gift code state
  const [giftCodeInput, setGiftCodeInput] = useState('');
  const [giftFeedback, setGiftFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [giftLoading, setGiftLoading] = useState(false);

  // Support state
  const [supportSubject, setSupportSubject] = useState('');
  const [supportCategory, setSupportCategory] =
    useState<FeedbackItem['category']>('General Inquiry');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportSent, setSupportSent] = useState(false);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportLoading, setSupportLoading] = useState(false);

  // Plan buy state
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  useEffect(() => {
    setDepError(null);
    setDepSuccess(false);
    setDepMethodId(enabledDepositMethods[0]?.id ?? '');
    setDepAmount(String(settings.minRechargeEtb));
    setDepRef('');
    setDepReceiptDataUrl('');

    setWdError(null);
    setWdSuccess(false);
    setWdMethodId(enabledWithdrawalMethods[0]?.id ?? '');
    setWdAmount(String(settings.minWithdrawalEtb));

    setPlanError(null);
    setPlanSuccess(null);
    setWelfareError(null);
    setWelfareSuccess(null);
    setSupportSent(false);
    setSupportError(null);
    setGiftFeedback(null);
  }, [modal?.type, settings.minRechargeEtb, settings.minWithdrawalEtb]);

  const [welfareError, setWelfareError] = useState<string | null>(null);
  const [welfareSuccess, setWelfareSuccess] = useState<string | null>(null);
  const [welfareLoading, setWelfareLoading] = useState(false);

  const handleBuyWelfare = async (planId: string, name: string, durationDays: number) => {
    setWelfareError(null);
    setWelfareLoading(true);
    try {
      await apiBuyWelfarePlan(planId);
      await onRefreshMe();
      setWelfareSuccess(
        `Welfare ${name} activated! Daily claims accumulate safely in your Welfare Vault for ${durationDays} days and release to your Wallet at maturity. Open the Purchased tab to manage daily claims.`
      );
    } catch (err) {
      setWelfareError((err as Error).message);
    } finally {
      setWelfareLoading(false);
    }
  };

  if (!modal) return null;

  const isFinancialModal = ['recharge', 'withdraw', 'giftcode', 'plan', 'welfare'].includes(modal.type);
  if (!FINANCIAL_FEATURES_ENABLED && isFinancialModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="financial-paused-title" className="w-full max-w-sm rounded-2xl border border-amber-200 bg-white p-5 shadow-xl space-y-3">
          <div className="flex items-center gap-2 text-amber-700">
            <Lock className="h-5 w-5" />
            <h2 id="financial-paused-title" className="font-display text-base font-bold text-slate-950">Feature temporarily paused</h2>
          </div>
          <p className="text-sm leading-relaxed text-slate-700">ZENTRO financial actions are disabled until the owner confirms the funds and authorizes the official release. No deposit, withdrawal, purchase, gift-code, or reward operation can be completed now.</p>
          <button type="button" onClick={onClose} className="w-full min-h-[42px] rounded-xl bg-blue-700 text-white text-sm font-semibold">Close</button>
        </div>
      </div>
    );
  }

  const selectedDepositMethod =
    enabledDepositMethods.find((m) => m.id === depMethodId) ?? enabledDepositMethods[0];
  const meetsWithdrawalRequirement = canRequestWithdrawal(purchasedCount);
  const wdPreview = calculateWithdrawalPreview(
    Number(wdAmount),
    settings.withdrawalFeePercent
  );

  const handleReceiptSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDepError(null);
    try {
      const dataUrl = await fileToBase64DataUrl(file);
      setDepReceiptDataUrl(dataUrl);
    } catch (err) {
      setDepError((err as Error).message);
    }
  };

  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDepError(null);
    setDepLoading(true);
    try {
      await apiCreateDeposit({
        amountEtb: Number(depAmount),
        referenceCode: depRef.trim(),
        paymentMethodId: selectedDepositMethod?.id ?? '',
        receiptDataUrl: depReceiptDataUrl,
      });
      await onRefreshMe();
      setDepSuccess(true);
    } catch (err) {
      setDepError((err as Error).message);
    } finally {
      setDepLoading(false);
    }
  };

  const handleWithdrawalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWdError(null);
    setWdLoading(true);
    try {
      await apiCreateWithdrawal({
        amountEtb: Number(wdAmount),
        paymentMethodId: wdMethodId || enabledWithdrawalMethods[0]?.id || '',
      });
      await onRefreshMe();
      setWdSuccess(true);
    } catch (err) {
      setWdError((err as Error).message);
    } finally {
      setWdLoading(false);
    }
  };

  const handleGiftCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    setGiftLoading(true);
    try {
      const res = await apiVerifyGiftCode(giftCodeInput);
      setGiftFeedback({ ok: true, message: res.message });
      await onRefreshMe();
    } catch (err) {
      setGiftFeedback({ ok: false, message: (err as Error).message });
    } finally {
      setGiftLoading(false);
    }
  };

  const handleSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSupportError(null);
    setSupportLoading(true);
    try {
      await apiSubmitSupport({
        category: supportCategory,
        subject: supportSubject.trim(),
        message: supportMessage.trim(),
      });
      await onRefreshMe();
      setSupportSent(true);
      setSupportSubject('');
      setSupportMessage('');
    } catch (err) {
      setSupportError((err as Error).message);
    } finally {
      setSupportLoading(false);
    }
  };

  const handleBuyPlan = async (planId: string, tier: string) => {
    setPlanError(null);
    setPlanLoading(true);
    try {
      await apiBuyVipPlan(planId);
      await onRefreshMe();
      setPlanSuccess(`${tier} activated! Check the Purchased tab.`);
    } catch (err) {
      setPlanError((err as Error).message);
    } finally {
      setPlanLoading(false);
    }
  };

  const handleMarkAllRead = async () => {
    await apiMarkNotificationsRead();
    await onRefreshMe();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/40 backdrop-blur-xs p-0 sm:p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-heading"
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-white border border-slate-200 p-5 sm:p-6 shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-4 pb-3.5 border-b border-slate-100">
          <div>
            <h2 id="modal-heading" className="font-display text-lg font-bold text-slate-950">
              {modal.type === 'recharge' && 'Deposit / Recharge'}
              {modal.type === 'withdraw' && 'Withdraw Funds'}
              {modal.type === 'giftcode' && 'Gift Code'}
              {modal.type === 'support' && 'Support'}
              {modal.type === 'notifications' && 'Notifications'}
              {modal.type === 'terms' && 'Terms & Conditions'}
              {modal.type === 'about' && 'About'}
              {modal.type === 'plan' && `${modal.plan.tier} · ${modal.plan.label}`}
              {modal.type === 'welfare' && `Welfare ${modal.plan.name}`}
            </h2>
            <p className="text-[11px] text-amber-700 font-medium">
              {modal.type === 'welfare'
                ? 'ZENTRO · Locked Welfare Vault Plan'
                : 'ZENTRO'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center justify-center cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="pt-4 space-y-4">
          {/* DEPOSIT / RECHARGE */}
          {modal.type === 'recharge' && (
            <>
              {depSuccess ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center space-y-3">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                  <h3 className="font-display text-base font-bold text-slate-950">
                    Deposit Submitted
                  </h3>
                  <p className="text-xs text-slate-700">
                    Your deposit request and receipt have been sent for Admin verification.
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-[42px] px-5 rounded-xl bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              ) : enabledDepositMethods.length === 0 ? (
                <p className="text-xs text-red-700">
                  No deposit payment methods are currently enabled by Admin.
                </p>
              ) : (
                <form onSubmit={handleDepositSubmit} className="space-y-3.5" noValidate>
                  <div>
                    <label
                      htmlFor="dep-method"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Deposit Method
                    </label>
                    <select
                      id="dep-method"
                      value={selectedDepositMethod?.id ?? ''}
                      onChange={(e) => setDepMethodId(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {enabledDepositMethods.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.methodName} — {m.accountName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedDepositMethod && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs space-y-1">
                      <p className="font-semibold text-slate-950">
                        Transfer to {selectedDepositMethod.methodName}
                      </p>
                      <p className="text-slate-700">
                        Account Name:{' '}
                        <span className="font-semibold text-slate-950">
                          {selectedDepositMethod.accountName}
                        </span>
                      </p>
                      <p className="text-slate-700">
                        Account Number:{' '}
                        <span className="font-mono font-bold text-blue-900">
                          {selectedDepositMethod.accountNumber}
                        </span>
                      </p>
                      <p className="text-[11px] text-amber-800">
                        Minimum Deposit: {settings.minRechargeEtb.toLocaleString()} ETB
                      </p>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="dep-amount"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Amount (ETB)
                    </label>
                    <input
                      id="dep-amount"
                      type="number"
                      min={settings.minRechargeEtb}
                      value={depAmount}
                      onChange={(e) => setDepAmount(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-mono tabular-nums text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="dep-ref"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Transaction Reference / Short Code
                    </label>
                    <input
                      id="dep-ref"
                      type="text"
                      value={depRef}
                      onChange={(e) => setDepRef(e.target.value)}
                      placeholder="e.g. FT26330ABC12"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-mono text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="dep-receipt"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Upload Receipt Image (PNG / JPEG / WebP)
                    </label>
                    <label
                      htmlFor="dep-receipt"
                      className="flex items-center justify-center gap-2 min-h-[48px] px-4 py-2.5 rounded-xl border border-dashed border-blue-400 bg-blue-50/40 hover:bg-blue-50 text-xs font-semibold text-blue-800 cursor-pointer transition-colors"
                    >
                      <Upload className="h-4 w-4" />
                      <span>
                        {depReceiptDataUrl
                          ? 'Change Receipt Image'
                          : 'Choose Receipt Image'}
                      </span>
                      <input
                        id="dep-receipt"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleReceiptSelect}
                        className="sr-only"
                      />
                    </label>
                    {depReceiptDataUrl && (
                      <div className="mt-2 rounded-xl border border-slate-200 p-2 bg-slate-50">
                        <img
                          src={depReceiptDataUrl}
                          alt="Uploaded receipt preview"
                          className="max-h-40 mx-auto rounded-lg object-contain"
                        />
                      </div>
                    )}
                  </div>

                  {depError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700"
                    >
                      {depError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={depLoading}
                    className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer transition-colors"
                  >
                    {depLoading ? 'Submitting...' : 'Submit Deposit Request'}
                  </button>
                </form>
              )}
            </>
          )}

          {/* WITHDRAWAL */}
          {modal.type === 'withdraw' && (
            <>
              {wdSuccess ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center space-y-3">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                  <h3 className="font-display text-base font-bold text-slate-950">
                    Withdrawal Requested
                  </h3>
                  <p className="text-xs text-slate-700">
                    Your withdrawal request has been submitted for Admin review.
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-[42px] px-5 rounded-xl bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <form onSubmit={handleWithdrawalSubmit} className="space-y-3.5" noValidate>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs space-y-1">
                    <p className="font-semibold text-slate-950">
                      Available Wallet: {currentUser.walletBalanceEtb.toLocaleString()} ETB
                    </p>
                    <p className="text-slate-700">
                      Min Withdrawal: {settings.minWithdrawalEtb.toLocaleString()} ETB ·
                      Fee: {settings.withdrawalFeePercent}%
                    </p>
                    {settings.withdrawalScheduleNote && (
                      <p className="text-[11px] text-slate-600">
                        {settings.withdrawalScheduleNote}
                      </p>
                    )}
                    <p
                      className={`text-[11px] font-semibold ${
                        meetsWithdrawalRequirement ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {meetsWithdrawalRequirement
                        ? `1-plan requirement met (${purchasedCount} plan${
                            purchasedCount === 1 ? '' : 's'
                          }).`
                        : 'Purchase at least 1 plan before first withdrawal.'}
                    </p>
                    {currentUser.bankAccount ? (
                      <p className="text-[11px] text-blue-900 font-medium">
                        Destination: {currentUser.bankAccount.method} ·{' '}
                        {currentUser.bankAccount.accountName} (
                        {currentUser.bankAccount.accountNumber})
                      </p>
                    ) : (
                      <p className="text-[11px] text-red-700 font-medium">
                        Save your bank account details in Me first.
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="wd-method"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Withdrawal Method
                    </label>
                    <select
                      id="wd-method"
                      value={wdMethodId}
                      onChange={(e) => setWdMethodId(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {enabledWithdrawalMethods.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.methodName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="wd-amount"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Amount (ETB)
                    </label>
                    <input
                      id="wd-amount"
                      type="number"
                      min={settings.minWithdrawalEtb}
                      value={wdAmount}
                      onChange={(e) => setWdAmount(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-mono tabular-nums text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex items-center justify-between text-xs">
                    <span className="text-slate-600">
                      Fee ({settings.withdrawalFeePercent}%):{' '}
                      <strong className="font-mono text-slate-900">
                        {wdPreview.feeEtb.toLocaleString()} ETB
                      </strong>
                    </span>
                    <span className="text-slate-600">
                      Net Receive:{' '}
                      <strong className="font-mono text-blue-800">
                        {wdPreview.netAmountEtb.toLocaleString()} ETB
                      </strong>
                    </span>
                  </div>

                  {wdError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700"
                    >
                      {wdError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={wdLoading || enabledWithdrawalMethods.length === 0}
                    className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer transition-colors"
                  >
                    {wdLoading ? 'Submitting...' : 'Submit Withdrawal Request'}
                  </button>
                </form>
              )}
            </>
          )}

          {/* NOTIFICATIONS (Top-Right Bell) */}
          {modal.type === 'notifications' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <Bell className="h-4 w-4 text-amber-600" />
                  <span>{notifications.length} Message(s)</span>
                </span>
                {notifications.some((n) => !n.isRead) && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-600">
                  No notifications yet.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-0.5">
                  {notifications.map((ntf) => {
                    const imgSrc = uploadImageUrl(ntf.imageFilename);
                    return (
                      <article
                        key={ntf.id}
                        className={`rounded-2xl border p-3.5 space-y-2 ${
                          ntf.isRead
                            ? 'border-slate-200 bg-white'
                            : 'border-amber-300 bg-amber-50/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-xs sm:text-sm font-bold text-slate-950">
                            {ntf.title}
                          </h3>
                          <span className="text-[11px] font-mono text-slate-500 shrink-0">
                            {ntf.createdAt}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                          {ntf.message}
                        </p>
                        {imgSrc && (
                          <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                            <img
                              src={imgSrc}
                              alt={ntf.title}
                              className="w-full max-h-56 object-contain"
                            />
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* GIFT CODE */}
          {modal.type === 'giftcode' && (
            <form onSubmit={handleGiftCheck} className="space-y-3.5">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-slate-700">
                <Gift className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Enter your ZENTRO promotional gift code.</span>
              </div>

              <div>
                <label
                  htmlFor="gift-code-input"
                  className="block text-xs font-semibold text-slate-800 mb-1"
                >
                  Gift Code
                </label>
                <input
                  id="gift-code-input"
                  type="text"
                  value={giftCodeInput}
                  onChange={(e) => setGiftCodeInput(e.target.value)}
                  placeholder="ZENTRO-VIP-2026"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-mono text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {giftFeedback && (
                <div
                  role="status"
                  className={`rounded-xl border px-3.5 py-2 text-xs font-medium ${
                    giftFeedback.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-red-200 bg-red-50 text-red-700'
                  }`}
                >
                  {giftFeedback.message}
                </div>
              )}

              <button
                type="submit"
                disabled={giftLoading}
                className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                {giftLoading ? 'Checking...' : 'Verify Code'}
              </button>
            </form>
          )}

          {/* SUPPORT */}
          {modal.type === 'support' && (
            <div className="space-y-4">
              {supportSent ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center space-y-3">
                  <CheckCircle2 className="h-7 w-7 text-emerald-600 mx-auto" />
                  <h3 className="font-display text-base font-bold text-slate-950">
                    Message Sent
                  </h3>
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-[42px] px-5 rounded-xl bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSupportSubmit} className="space-y-3" noValidate>
                  <div>
                    <label
                      htmlFor="support-category"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Category
                    </label>
                    <select
                      id="support-category"
                      value={supportCategory}
                      onChange={(e) =>
                        setSupportCategory(e.target.value as FeedbackItem['category'])
                      }
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="General Inquiry">General Inquiry</option>
                      <option value="Technical Feedback">Technical Feedback</option>
                      <option value="Account Issue">Account Issue</option>
                      <option value="Complaint">Complaint</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="support-subject"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Subject
                    </label>
                    <input
                      id="support-subject"
                      type="text"
                      value={supportSubject}
                      onChange={(e) => setSupportSubject(e.target.value)}
                      placeholder="Subject"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="support-message"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Message
                    </label>
                    <textarea
                      id="support-message"
                      rows={3}
                      value={supportMessage}
                      onChange={(e) => setSupportMessage(e.target.value)}
                      placeholder="Write your message..."
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  {supportError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                    >
                      {supportError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={supportLoading}
                    className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
                  >
                    {supportLoading ? 'Sending...' : 'Submit Feedback'}
                  </button>
                </form>
              )}

              {feedbackMessages.length > 0 && (
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <p className="text-xs font-semibold text-slate-700">Your Support History</p>
                  {feedbackMessages.slice(0, 4).map((fb) => (
                    <div
                      key={fb.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-950">{fb.subject}</span>
                        <span className="text-[11px] font-semibold text-blue-800">
                          {fb.status}
                        </span>
                      </div>
                      <p className="text-slate-700">{fb.message}</p>
                      {fb.adminReply && (
                        <p className="rounded-lg bg-white border border-amber-200 px-2.5 py-1.5 text-slate-900">
                          <span className="font-semibold text-amber-800">Admin Reply: </span>
                          {fb.adminReply}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TERMS REVIEW */}
          {modal.type === 'terms' && (
            <>
              <RegistrationTermsContent settings={settings} />
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold cursor-pointer"
              >
                Close
              </button>
            </>
          )}

          {/* ABOUT US */}
          {modal.type === 'about' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3 text-sm text-slate-800">
                <div className="space-y-1">
                  <p className="font-display text-base font-bold text-slate-950">
                    👑 WELCOME TO ZENTRO! 🌍✨
                  </p>
                  <p className="font-semibold text-blue-800">
                    🚀 ZENTRO – Dream • Work • Earn
                  </p>
                  <p className="text-xs sm:text-sm leading-relaxed text-slate-700">
                    ZENTRO is a name that represents ambition, innovation, opportunity, and
                    growth. Our vision is to inspire people to think bigger, work smarter,
                    and move closer to their dreams.
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-200/80 space-y-1">
                  <p className="font-display text-sm font-bold text-slate-950">
                    💎 Our Vision
                  </p>
                  <p className="text-xs sm:text-sm leading-relaxed text-slate-700">
                    To build a community driven by progress, opportunity, and success.
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                  <p className="font-display text-sm font-bold text-slate-950">
                    🌟 Our Values
                  </p>
                  <ul className="space-y-1 text-xs sm:text-sm text-slate-800 list-disc pl-5">
                    <li>Innovation &amp; Growth</li>
                    <li>Teamwork &amp; Cooperation</li>
                    <li>Transparency &amp; Trust</li>
                    <li>Commitment &amp; Excellence</li>
                    <li>Global Opportunities</li>
                  </ul>
                </div>

                <div className="pt-2 border-t border-amber-200 bg-amber-50/70 rounded-xl p-3 space-y-1 text-xs sm:text-sm">
                  <p className="font-semibold text-slate-950">
                    🔥 Your Dreams Matter. Your Effort Counts. Your Future Starts Here!
                  </p>
                  <p className="font-display font-bold text-blue-800">
                    👑 ZENTRO – BEYOND LIMITS!
                  </p>
                  <p className="font-medium text-amber-800">
                    ✨ Your Success, Our Priority.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          )}

          {/* VIP BUY PLAN MODAL */}
          {modal.type === 'plan' && (
            <>
              <div className="rounded-2xl border border-amber-200 bg-slate-50 p-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Crown className="h-5 w-5 text-amber-600" />
                    <span className="font-display text-base font-bold text-slate-950">
                      {modal.plan.tier}
                    </span>
                  </div>
                  <span className="font-semibold text-amber-700">
                    {modal.plan.label}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/80">
                  <div>
                    <span className="block text-slate-500">Investment</span>
                    <span className="font-mono tabular-nums font-bold text-slate-950">
                      {modal.plan.investmentEtb.toLocaleString()} ETB
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-500">Daily Income</span>
                    <span className="font-mono tabular-nums font-bold text-blue-800">
                      {modal.plan.dailyIncomeEtb.toLocaleString()} ETB
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-500">Duration</span>
                    <span className="font-mono tabular-nums font-bold text-slate-950">
                      {modal.plan.cycleDays} Days
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 flex items-center justify-between text-xs">
                <span className="text-slate-600">Wallet Balance</span>
                <span className="font-mono tabular-nums font-bold text-slate-950">
                  {currentUser.walletBalanceEtb.toLocaleString()} ETB
                </span>
              </div>

              {planError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700"
                >
                  {planError}
                </div>
              )}

              {planSuccess ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center space-y-2.5">
                  <p className="text-xs font-semibold text-emerald-800">{planSuccess}</p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-[40px] px-4 rounded-xl bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={planLoading}
                  onClick={() => handleBuyPlan(modal.plan.id, modal.plan.tier)}
                  className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Crown className="h-4 w-4 text-amber-300" />
                  <span>
                    {planLoading
                      ? 'Activating...'
                      : `Buy ${modal.plan.tier} (${modal.plan.investmentEtb.toLocaleString()} ETB)`}
                  </span>
                </button>
              )}
            </>
          )}

          {/* WELFARE PLAN INVEST MODAL */}
          {modal.type === 'welfare' && (() => {
            const imgSrc = WELFARE_PLAN_IMAGES[modal.plan.id];
            const totalReturn = modal.plan.dailyAmountEtb * modal.plan.durationDays;
            return (
              <div className="space-y-4">
                <div className="aspect-[16/10] w-full overflow-hidden rounded-2xl border border-amber-200 bg-slate-50">
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={`ZENTRO Welfare ${modal.plan.name}`}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover object-center"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center bg-blue-900 text-amber-300 font-display font-bold">
                      ZENTRO · {modal.plan.name}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-amber-200 bg-slate-50 p-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-blue-700" />
                      <span className="font-display text-base font-bold text-slate-950">
                        {modal.plan.name}
                      </span>
                    </div>
                    <span className="font-semibold text-amber-700">
                      {modal.plan.durationDays} Days Lock
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200/80">
                    <div>
                      <span className="block text-slate-500">Investment</span>
                      <span className="font-mono tabular-nums font-bold text-slate-950">
                        {modal.plan.investmentEtb.toLocaleString()} ETB
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-500">Daily Profit</span>
                      <span className="font-mono tabular-nums font-bold text-blue-800">
                        {modal.plan.dailyAmountEtb.toLocaleString()} ETB
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-500">Duration</span>
                      <span className="font-mono tabular-nums font-bold text-slate-950">
                        {modal.plan.durationDays} Days
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-500">Total Saved</span>
                      <span className="font-mono tabular-nums font-bold text-amber-800">
                        {totalReturn.toLocaleString()} ETB
                      </span>
                    </div>
                  </div>
                </div>

                {/* Locked Savings & Maturity Rule */}
                <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-900">
                      <Lock className="h-4 w-4 text-amber-600 shrink-0" />
                      <span>Welfare Lock Duration</span>
                    </span>
                    <span className="text-xs font-bold text-blue-900 whitespace-nowrap shrink-0">
                      {modal.plan.durationDays} Days · Starts on investment
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-700 leading-relaxed">
                    The {modal.plan.durationDays}-day countdown starts after you invest.
                    Daily claimed profits save separately in your Welfare Vault and
                    automatically transfer into your Wallet once Day {modal.plan.durationDays}{' '}
                    completes.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 flex items-center justify-between text-xs">
                  <span className="text-slate-600">Wallet Balance</span>
                  <span className="font-mono tabular-nums font-bold text-slate-950">
                    {currentUser.walletBalanceEtb.toLocaleString()} ETB
                  </span>
                </div>

                {welfareError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700"
                  >
                    {welfareError}
                  </div>
                )}

                {welfareSuccess ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center space-y-2.5">
                    <p className="text-xs font-semibold text-emerald-800 leading-relaxed">
                      {welfareSuccess}
                    </p>
                    <button
                      type="button"
                      onClick={onClose}
                      className="min-h-[40px] px-4 rounded-xl bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={welfareLoading}
                    onClick={() =>
                      handleBuyWelfare(
                        modal.plan.id,
                        modal.plan.name,
                        modal.plan.durationDays
                      )
                    }
                    className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <ShieldCheck className="h-4 w-4 text-amber-300" />
                    <span>
                      {welfareLoading
                        ? 'Activating...'
                        : `Invest in ${modal.plan.name} (${modal.plan.investmentEtb.toLocaleString()} ETB)`}
                    </span>
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
