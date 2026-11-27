import React, { useEffect, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Crown,
  Gift,
  Headphones,
  Megaphone,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { ROTATING_BANNER_SLIDES, WELFARE_PLANS } from '../utils/zentroLogic';
import { DAILY_PLAN_IMAGES, WELFARE_PLAN_IMAGES } from '../assets/planImages';
import { FINANCIAL_FEATURES_ENABLED, uploadImageUrl } from '../services/api';
import { ActiveModal, BroadcastItem, VipPlan, WelfarePlan } from '../types/zentro';

interface HomeViewProps {
  activeBroadcast: BroadcastItem | null;
  vipPlans: VipPlan[];
  welfarePlans?: WelfarePlan[];
  walletBalanceEtb: number;
  welfareVaultEtb: number;
  onOpenModal: (modal: ActiveModal) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  activeBroadcast,
  vipPlans,
  welfarePlans,
  walletBalanceEtb,
  welfareVaultEtb,
  onOpenModal,
}) => {
  const activeWelfarePlans =
    welfarePlans && welfarePlans.length > 0 ? welfarePlans : WELFARE_PLANS;
  const [slideIndex, setSlideIndex] = useState(0);
  const [planTab, setPlanTab] = useState<'daily' | 'welfare'>('daily');
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % ROTATING_BANNER_SLIDES.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const currentSlide = ROTATING_BANNER_SLIDES[slideIndex];
  const broadcastImg = uploadImageUrl(activeBroadcast?.imageFilename);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Automatic Rotating ZENTRO Banner Logos (no manual switch controls) */}
      <section aria-label="Featured ZENTRO showcase">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-amber-300/80 bg-white shadow-xs select-none">
          <div className="relative h-48 sm:h-60 w-full bg-slate-950 overflow-hidden">
            {!imgErrors[currentSlide.id] ? (
              <img
                src={currentSlide.imageSrc}
                alt={currentSlide.alt}
                referrerPolicy="no-referrer"
                onError={() =>
                  setImgErrors((prev) => ({ ...prev, [currentSlide.id]: true }))
                }
                className="h-full w-full object-cover object-center transition-opacity duration-500 pointer-events-none"
              />
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700 text-white p-4 text-center">
                <span className="font-display text-lg font-bold tracking-wide">
                  ZENTRO
                </span>
                <span className="text-[11px] text-amber-300 font-semibold">
                  BEYOND LIMITS
                </span>
              </div>
            )}
          </div>

          <div className="px-4 py-2.5 bg-white border-t border-amber-100 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-xs sm:text-sm font-bold text-slate-950 truncate">
                {currentSlide.title}
              </p>
              <p className="text-[11px] text-slate-600 truncate">{currentSlide.subtitle}</p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 pointer-events-none" aria-hidden="true">
              {ROTATING_BANNER_SLIDES.map((slide, idx) => (
                <span
                  key={slide.id}
                  className={`h-2 rounded-full transition-all ${
                    idx === slideIndex
                      ? 'w-5 bg-gradient-to-r from-amber-500 to-yellow-500'
                      : 'w-2 bg-slate-300'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Broadcast Announcement */}
      {activeBroadcast && (
        <button
          type="button"
          onClick={() => onOpenModal({ type: 'notifications' })}
          aria-label="Latest announcement"
          className="w-full text-left rounded-2xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 flex items-center gap-3 hover:border-amber-400 transition-colors cursor-pointer"
        >
          <Megaphone className="h-4 w-4 text-amber-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-900 truncate">
              <span className="font-semibold text-slate-950">{activeBroadcast.title}:</span>{' '}
              {activeBroadcast.message}
            </p>
          </div>
          {broadcastImg && (
            <img
              src={broadcastImg}
              alt=""
              className="h-8 w-8 rounded-lg object-cover border border-amber-200 shrink-0"
            />
          )}
        </button>
      )}

      {/* Prominent Customer Total Balance Card */}
      <section
        aria-label="Total Balance"
        className="rounded-2xl border border-amber-300 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white px-4 py-3.5 shadow-xs flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-11 w-11 rounded-xl bg-white/10 border border-amber-300/60 text-amber-300 flex items-center justify-center shrink-0">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-amber-300">
              Total Balance
            </span>
            <span className="block font-mono tabular-nums text-2xl sm:text-3xl font-extrabold text-white leading-tight truncate">
              {walletBalanceEtb.toLocaleString()} ETB
            </span>
          </div>
        </div>

        {welfareVaultEtb > 0 && (
          <div className="rounded-xl bg-white/10 border border-white/20 px-3 py-1.5 text-right shrink-0">
            <span className="block text-[10px] font-medium text-amber-200">
              Welfare Vault
            </span>
            <span className="block font-mono tabular-nums text-xs sm:text-sm font-bold text-white">
              {welfareVaultEtb.toLocaleString()} ETB
            </span>
          </div>
        )}
      </section>

      {/* Financial actions remain paused until release approval. */}
      {!FINANCIAL_FEATURES_ENABLED && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900">
          Deposits, withdrawals, gift codes, rewards, and plan purchases are paused until ZENTRO is officially released.
        </p>
      )}
      {/* 4 Shortcut Actions */}
      <section aria-label="Quick shortcuts">
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          <button
            type="button"
            disabled={!FINANCIAL_FEATURES_ENABLED}
            onClick={() => onOpenModal({ type: 'recharge' })}
            className="min-h-[64px] rounded-2xl border border-slate-200 bg-white p-2 sm:p-3 flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 sm:gap-2.5 transition-colors text-center sm:text-left shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="h-8 w-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              <ArrowDownCircle className="h-4 w-4" />
            </span>
            <span className="text-[11px] sm:text-xs font-semibold text-slate-950 whitespace-nowrap">
              Recharge
            </span>
          </button>

          <button
            type="button"
            disabled={!FINANCIAL_FEATURES_ENABLED}
            onClick={() => onOpenModal({ type: 'withdraw' })}
            className="min-h-[64px] rounded-2xl border border-slate-200 bg-white hover:border-blue-600 p-2 sm:p-3 flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 sm:gap-2.5 transition-colors cursor-pointer text-center sm:text-left shadow-xs"
          >
            <span className="h-8 w-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              <ArrowUpCircle className="h-4 w-4" />
            </span>
            <span className="text-[11px] sm:text-xs font-semibold text-slate-950 whitespace-nowrap">
              Withdraw
            </span>
          </button>

          <button
            type="button"
            disabled={!FINANCIAL_FEATURES_ENABLED}
            onClick={() => onOpenModal({ type: 'giftcode' })}
            className="min-h-[64px] rounded-2xl border border-slate-200 bg-white p-2 sm:p-3 flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 sm:gap-2.5 transition-colors text-center sm:text-left shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="h-8 w-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Gift className="h-4 w-4" />
            </span>
            <span className="text-[11px] sm:text-xs font-semibold text-slate-950 whitespace-nowrap">
              Gift Code
            </span>
          </button>

          <button
            type="button"
            onClick={() => onOpenModal({ type: 'support' })}
            className="min-h-[64px] rounded-2xl border border-slate-200 bg-white hover:border-blue-600 p-2 sm:p-3 flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 sm:gap-2.5 transition-colors cursor-pointer text-center sm:text-left shadow-xs"
          >
            <span className="h-8 w-8 rounded-xl bg-slate-100 text-blue-700 flex items-center justify-center shrink-0">
              <Headphones className="h-4 w-4" />
            </span>
            <span className="text-[11px] sm:text-xs font-semibold text-slate-950 whitespace-nowrap">
              Support
            </span>
          </button>
        </div>
      </section>

      {/* Equal-Width Side-by-Side Home Plan Tabs */}
      <section aria-label="Plan categories" className="space-y-3.5">
        <div
          role="tablist"
          aria-label="ZENTRO plan types"
          className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-slate-100 border border-slate-200/80"
        >
          <button
            type="button"
            role="tab"
            id="tab-daily-plan"
            aria-selected={planTab === 'daily'}
            aria-controls="panel-daily-plan"
            onClick={() => setPlanTab('daily')}
            className={`w-full min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 ${
              planTab === 'daily'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-950'
            }`}
          >
            <Crown
              className={`h-4 w-4 shrink-0 ${
                planTab === 'daily' ? 'text-amber-300' : 'text-amber-600'
              }`}
            />
            <span>Daily Plan</span>
          </button>

          <button
            type="button"
            role="tab"
            id="tab-welfare-plan"
            aria-selected={planTab === 'welfare'}
            aria-controls="panel-welfare-plan"
            onClick={() => setPlanTab('welfare')}
            className={`w-full min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 ${
              planTab === 'welfare'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-950'
            }`}
          >
            <ShieldCheck
              className={`h-4 w-4 shrink-0 ${
                planTab === 'welfare' ? 'text-amber-300' : 'text-blue-700'
              }`}
            />
            <span>Welfare Plan</span>
          </button>
        </div>

        {/* DAILY PLAN TAB PANEL */}
        {planTab === 'daily' && (
          <div
            id="panel-daily-plan"
            role="tabpanel"
            aria-labelledby="tab-daily-plan"
            className="space-y-3 transition-opacity duration-200"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-amber-500 shrink-0" />
                <h2 className="font-display text-lg sm:text-xl font-bold text-slate-950">
                  VIP Packages
                </h2>
              </div>
              <span className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                {vipPlans.length} Plans
              </span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {vipPlans.map((plan) => {
                const imgSrc = DAILY_PLAN_IMAGES[plan.id];
                const imgErrKey = `daily-${plan.id}`;
                return (
                  <article
                    key={plan.id}
                    className="relative overflow-hidden rounded-2xl border border-amber-200/90 bg-white flex flex-col justify-between shadow-xs hover:border-amber-400 transition-colors"
                  >
                    <div
                      aria-hidden="true"
                      className="h-1 w-full bg-gradient-to-r from-amber-300 via-yellow-500 to-amber-400"
                    />

                    {/* Custom ZENTRO Plan Image */}
                    <div className="aspect-[4/3] w-full bg-slate-50 border-b border-amber-100 overflow-hidden">
                      {imgSrc && !imgErrors[imgErrKey] ? (
                        <img
                          src={imgSrc}
                          alt={`ZENTRO ${plan.tier} ${plan.label}`}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setImgErrors((prev) => ({ ...prev, [imgErrKey]: true }))
                          }
                          className="h-full w-full object-cover object-center"
                        />
                      ) : (
                        <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-blue-800 to-blue-950 text-white p-3">
                          <span className="font-display text-sm font-bold tracking-wide text-amber-300">
                            ZENTRO
                          </span>
                          <span className="text-[11px] font-semibold">{plan.tier}</span>
                        </div>
                      )}
                    </div>

                    <div className="p-3 sm:p-4 flex-1 flex flex-col justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-1.5">
                          <h3 className="font-display text-sm sm:text-base font-bold text-slate-950 truncate">
                            {plan.tier}
                          </h3>
                          <span className="text-[11px] font-semibold text-amber-700 shrink-0">
                            {plan.label}
                          </span>
                        </div>

                        <div className="space-y-1 text-xs pt-1.5 border-t border-amber-100">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-slate-600">Investment</span>
                            <span className="font-mono tabular-nums font-bold text-slate-950">
                              {plan.investmentEtb.toLocaleString()} ETB
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-slate-600">Daily Income</span>
                            <span className="font-mono tabular-nums font-bold text-blue-800">
                              {plan.dailyIncomeEtb.toLocaleString()} ETB
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-slate-600">Duration</span>
                            <span className="font-mono tabular-nums font-semibold text-slate-900">
                              {plan.cycleDays} Days
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!FINANCIAL_FEATURES_ENABLED}
                        onClick={() => onOpenModal({ type: 'plan', plan })}
                        className="w-full min-h-[40px] sm:min-h-[44px] rounded-xl bg-blue-700 text-white text-xs sm:text-sm font-semibold transition-colors cursor-not-allowed opacity-50 disabled:cursor-not-allowed"
                      >
                        Buy Plan
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* WELFARE PLAN TAB PANEL */}
        {planTab === 'welfare' && (
          <div
            id="panel-welfare-plan"
            role="tabpanel"
            aria-labelledby="tab-welfare-plan"
            className="space-y-3 transition-opacity duration-200"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-700 shrink-0" />
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-bold text-slate-950">
                    Welfare Plans
                  </h2>
                  <p className="text-[11px] text-slate-600">
                    Daily profit saves safely · Unlocks to wallet at maturity
                  </p>
                </div>
              </div>
              <span className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 shrink-0">
                {activeWelfarePlans.length} Plans
              </span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {activeWelfarePlans.map((plan) => {
                const imgSrc = WELFARE_PLAN_IMAGES[plan.id];
                const imgErrKey = `welfare-${plan.id}`;
                return (
                  <article
                    key={plan.id}
                    className="relative overflow-hidden rounded-2xl border border-amber-200/90 bg-white flex flex-col justify-between shadow-xs hover:border-blue-600 transition-colors"
                  >
                    <div
                      aria-hidden="true"
                      className="h-1 w-full bg-gradient-to-r from-blue-700 via-amber-400 to-blue-700"
                    />

                    {/* Unique ZENTRO Welfare Image */}
                    <div className="aspect-[4/3] w-full bg-slate-50 border-b border-amber-100 overflow-hidden">
                      {imgSrc && !imgErrors[imgErrKey] ? (
                        <img
                          src={imgSrc}
                          alt={`ZENTRO Welfare ${plan.name}`}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setImgErrors((prev) => ({ ...prev, [imgErrKey]: true }))
                          }
                          className="h-full w-full object-cover object-center"
                        />
                      ) : (
                        <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-blue-800 to-slate-900 text-white p-3">
                          <span className="font-display text-sm font-bold tracking-wide text-amber-300">
                            ZENTRO
                          </span>
                          <span className="text-[11px] font-semibold">{plan.name}</span>
                        </div>
                      )}
                    </div>

                    <div className="p-3 sm:p-4 flex-1 flex flex-col justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-1.5">
                          <h3 className="font-display text-sm sm:text-base font-bold text-slate-950">
                            {plan.name}
                          </h3>
                          <span className="text-[11px] font-semibold text-amber-700 shrink-0">
                            {plan.durationDays} Days
                          </span>
                        </div>

                        <div className="space-y-1 text-xs pt-1.5 border-t border-amber-100">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-slate-600">Investment</span>
                            <span className="font-mono tabular-nums font-bold text-slate-950">
                              {plan.investmentEtb.toLocaleString()} ETB
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-slate-600">Daily Amount</span>
                            <span className="font-mono tabular-nums font-bold text-blue-800">
                              {plan.dailyAmountEtb.toLocaleString()} ETB
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-slate-600">Duration</span>
                            <span className="font-mono tabular-nums font-semibold text-slate-900">
                              {plan.durationDays} Days
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!FINANCIAL_FEATURES_ENABLED}
                        onClick={() => onOpenModal({ type: 'welfare', plan })}
                        className="w-full min-h-[40px] sm:min-h-[44px] rounded-xl border border-amber-400 bg-gradient-to-r from-blue-700 to-blue-800 text-white text-xs sm:text-sm font-semibold transition-colors cursor-not-allowed opacity-50 disabled:cursor-not-allowed"
                      >
                        Buy Plan
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
