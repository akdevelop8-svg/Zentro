import React, { useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  History,
  Lock,
  ShieldCheck,
  ShoppingBag,
  Unlock,
} from 'lucide-react';
import { FINANCIAL_FEATURES_ENABLED, apiClaimWelfareDaily, apiReleaseWelfareVault } from '../services/api';
import {
  ActivityHistoryEntry,
  PurchasedPlanRecord,
  WelfareEnrollmentRecord,
} from '../types/zentro';
import {
  calculateTotalProfitEtb,
  formatCountdown,
  formatMultiDayCountdown,
  getWelfareClaimState,
} from '../utils/zentroLogic';

interface PurchasedViewProps {
  records: PurchasedPlanRecord[];
  welfareEnrollments: WelfareEnrollmentRecord[];
  activities: ActivityHistoryEntry[];
  onRefreshMe: () => Promise<void>;
}

export const PurchasedView: React.FC<PurchasedViewProps> = ({
  records,
  welfareEnrollments,
  activities,
  onRefreshMe,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    id: string;
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const handleClaimWelfare = async (enrollment: WelfareEnrollmentRecord) => {
    setBusyId(enrollment.id);
    setFeedback(null);
    try {
      const res = await apiClaimWelfareDaily(enrollment.id);
      await onRefreshMe();
      setFeedback({
        id: enrollment.id,
        ok: true,
        message: res.releasedToWallet
          ? `Day ${res.claimedDays} claimed and ${res.accumulatedEtb.toLocaleString()} ETB moved into your Wallet!`
          : `Saved +${enrollment.dailyAmountEtb.toLocaleString()} ETB to your locked Welfare Vault (${res.accumulatedEtb.toLocaleString()} ETB total).`,
      });
    } catch (err) {
      setFeedback({
        id: enrollment.id,
        ok: false,
        message: (err as Error).message,
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReleaseWelfare = async (enrollment: WelfareEnrollmentRecord) => {
    setBusyId(enrollment.id);
    setFeedback(null);
    try {
      const res = await apiReleaseWelfareVault(enrollment.id);
      await onRefreshMe();
      setFeedback({
        id: enrollment.id,
        ok: true,
        message: `${res.releasedEtb.toLocaleString()} ETB moved into your main Wallet for withdrawal.`,
      });
    } catch (err) {
      setFeedback({
        id: enrollment.id,
        ok: false,
        message: (err as Error).message,
      });
    } finally {
      setBusyId(null);
    }
  };

  const hasAnyPlans = records.length > 0 || welfareEnrollments.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-950">
          Purchased
        </h1>
        <span className="text-xs font-semibold text-amber-700">
          {records.length + welfareEnrollments.length} Plan(s)
        </span>
      </div>

      {!hasAnyPlans ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-1.5">
          <ShoppingBag className="h-7 w-7 text-slate-400 mx-auto" />
          <p className="font-display text-sm font-semibold text-slate-950">
            No Purchased Plans Yet
          </p>
          <p className="text-xs text-slate-600">
            Select a Daily VIP or Welfare package on Home to activate your first plan.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Welfare Plans (Locked Savings Vault) */}
          {welfareEnrollments.length > 0 && (
            <section aria-label="Welfare Plans Vault" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-blue-700" />
                  <h2 className="font-display text-base sm:text-lg font-bold text-slate-950">
                    Welfare Plans (Locked Vault)
                  </h2>
                </div>
                <span className="text-[11px] font-semibold text-blue-800">
                  Unlocks at Maturity
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {welfareEnrollments.map((w) => {
                  const state = getWelfareClaimState(w, nowMs);
                  const maturityCountdown = formatMultiDayCountdown(
                    state.maturityRemainingSeconds,
                    w.durationDays
                  );
                  const nextClaimCountdown = formatCountdown(
                    state.nextClaimRemainingSeconds
                  );
                  const isCompleted = w.status === 'Completed';
                  const rowFeedback = feedback?.id === w.id ? feedback : null;

                  return (
                    <article
                      key={w.id}
                      className={`rounded-2xl border bg-white p-4 sm:p-5 space-y-3.5 shadow-xs ${
                        isCompleted ? 'border-emerald-300' : 'border-blue-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-display text-base sm:text-lg font-bold text-slate-950">
                              Welfare {w.planName}
                            </h3>
                            <span
                              className={`text-xs font-semibold ${
                                isCompleted ? 'text-emerald-700' : 'text-blue-700'
                              }`}
                            >
                              · {isCompleted ? 'In Wallet' : 'Locked'}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 mt-1">
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5 text-slate-400" />
                              {w.startedAt}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-blue-800">
                              Day {state.currentDay} of {w.durationDays}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {w.claimedDays}/{w.durationDays} Claimed
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="font-mono tabular-nums text-sm font-bold text-slate-950 block">
                            {w.investmentEtb.toLocaleString()} ETB
                          </span>
                          <span className="text-[11px] font-mono text-amber-700 font-semibold">
                            +{w.dailyAmountEtb.toLocaleString()} ETB/day
                          </span>
                        </div>
                      </div>

                      {/* Separately Saved Welfare Vault & Maturity Countdown */}
                      <div className="grid grid-cols-2 gap-2.5 text-xs">
                        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                          <span className="block text-[11px] text-amber-900 font-medium">
                            {isCompleted ? 'Released to Wallet' : 'Saved Separately (Vault)'}
                          </span>
                          <span className="font-mono tabular-nums text-base font-bold text-slate-950">
                            {w.accumulatedEtb.toLocaleString()} ETB
                          </span>
                        </div>
                        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
                          <span className="block text-[11px] text-blue-900 font-medium">
                            {isCompleted ? 'Status' : `Unlocks (Day ${w.durationDays})`}
                          </span>
                          <span className="font-mono tabular-nums text-sm font-bold text-blue-900">
                            {isCompleted ? 'Completed' : maturityCountdown.formatted}
                          </span>
                        </div>
                      </div>

                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-emerald-900">Total Plan Profit</span>
                        <span className="font-mono tabular-nums text-sm font-bold text-emerald-800">
                          {calculateTotalProfitEtb(w.dailyAmountEtb, w.durationDays).toLocaleString()} ETB
                        </span>
                      </div>

                      {/* Maturity Lock Progress */}
                      {!isCompleted && (
                        <div className="space-y-1.5">
                          <div
                            role="progressbar"
                            aria-valuenow={maturityCountdown.progressPercent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`Welfare ${w.planName} lock progress`}
                            className="h-2 w-full rounded-full bg-slate-200 overflow-hidden"
                          >
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-blue-700 to-amber-500 transition-all duration-300"
                              style={{
                                width: `${Math.max(4, maturityCountdown.progressPercent)}%`,
                              }}
                            />
                          </div>
                          <p className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                            <Lock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                            <span>
                              {state.isMatured
                                ? 'Maturity reached — your accumulated profit is ready for your Wallet.'
                                : `Safe & locked until Day ${w.durationDays}. Cannot be withdrawn early.`}
                            </span>
                          </p>
                        </div>
                      )}

                      {rowFeedback && (
                        <p
                          role="status"
                          className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                            rowFeedback.ok
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-red-200 bg-red-50 text-red-700'
                          }`}
                        >
                          {rowFeedback.message}
                        </p>
                      )}

                      {!isCompleted ? (
                        <div className="flex flex-col sm:flex-row gap-2">
                          {!FINANCIAL_FEATURES_ENABLED ? (
                            <p className="flex-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900">Daily claims are paused until the official release.</p>
                          ) : state.canClaimDaily ? (
                            <button
                              type="button"
                              disabled={busyId === w.id}
                              onClick={() => handleClaimWelfare(w)}
                              className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer transition-colors"
                            >
                              {busyId === w.id
                                ? 'Saving...'
                                : `Claim Daily (+${w.dailyAmountEtb.toLocaleString()} ETB to Vault)`}
                            </button>
                          ) : w.claimedDays < w.durationDays ? (
                            <div className="flex-1 min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
                              <span className="text-slate-600">Next claim in</span>
                              <span className="font-mono tabular-nums font-bold text-blue-800">
                                {nextClaimCountdown.formatted}
                              </span>
                            </div>
                          ) : null}

                          {FINANCIAL_FEATURES_ENABLED && state.canReleaseToWallet && (
                            <button
                              type="button"
                              disabled={busyId === w.id}
                              onClick={() => handleReleaseWelfare(w)}
                              className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                            >
                              <Unlock className="h-4 w-4" />
                              <span>
                                Move {w.accumulatedEtb.toLocaleString()} ETB to Wallet
                              </span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 flex items-center gap-2 text-xs font-semibold text-emerald-800">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          <span>
                            Moved {w.accumulatedEtb.toLocaleString()} ETB to Wallet
                            {w.releasedAt ? ` · ${w.releasedAt}` : ''}
                          </span>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* Daily VIP Plans */}
          {records.length > 0 && (
            <section aria-label="Daily VIP Plans" className="space-y-3">
              {welfareEnrollments.length > 0 && (
                <h2 className="font-display text-base sm:text-lg font-bold text-slate-950">
                  Daily VIP Plans
                </h2>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {records.map((rec) => {
                  const remainingSeconds = Math.max(
                    0,
                    Math.floor((rec.nextCycleAt - nowMs) / 1000)
                  );
                  const countdown = formatCountdown(remainingSeconds);
                  const isActive = rec.status === 'Active';

                  return (
                    <article
                      key={rec.id}
                      className={`rounded-2xl border bg-white p-4 sm:p-5 space-y-3.5 shadow-xs ${
                        isActive ? 'border-amber-300/90' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-display text-base sm:text-lg font-bold text-slate-950">
                              {rec.tier}
                            </h3>
                            <span
                              className={`text-xs font-semibold ${
                                isActive ? 'text-amber-700' : 'text-slate-500'
                              }`}
                            >
                              · {rec.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-600 mt-1">
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5 text-slate-400" />
                              {rec.purchaseDate}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{rec.cycleDays} Days</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-mono tabular-nums text-sm font-bold text-blue-800 block">
                            {rec.investmentEtb.toLocaleString()} ETB
                          </span>
                          <span className="text-[11px] font-mono text-amber-700 font-semibold">
                            +{rec.dailyIncomeEtb.toLocaleString()} ETB/day
                          </span>
                          <span className="block text-[11px] font-mono text-emerald-700 font-semibold mt-1">
                            Total Profit: {calculateTotalProfitEtb(rec.dailyIncomeEtb, rec.cycleDays).toLocaleString()} ETB
                          </span>
                        </div>
                      </div>

                      {/* 24h Cycle Countdown */}
                      <div className="rounded-xl border border-amber-200/70 bg-slate-50 p-3.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                            <Clock className="h-4 w-4 text-amber-600" />
                            24h Activity Countdown
                          </span>
                          <span className="font-mono tabular-nums text-base font-bold text-blue-800">
                            {countdown.formatted}
                          </span>
                        </div>

                        <div
                          role="progressbar"
                          aria-valuenow={countdown.progressPercent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${rec.tier} 24-hour cycle progress`}
                          className="h-2 w-full rounded-full bg-slate-200 overflow-hidden"
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-700 via-blue-600 to-amber-500 transition-all duration-300"
                            style={{ width: `${countdown.progressPercent}%` }}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Activity History */}
      <section aria-label="Activity history" className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-blue-700" />
          <h2 className="font-display text-base sm:text-lg font-bold text-slate-950">
            Activity History
          </h2>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {activities.length === 0 ? (
            <p className="p-5 text-xs text-slate-600 text-center">No activity yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {activities.map((item) => (
                <div
                  key={item.id}
                  className="px-4 py-3 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-semibold text-slate-950 truncate">
                      {item.action}
                    </p>
                    <p className="text-[11px] text-slate-600 font-mono tabular-nums">
                      {item.planTier} · {item.timestamp}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-blue-800 shrink-0">
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
