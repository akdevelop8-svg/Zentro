import React, { useState } from 'react';
import { Check, FileText } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { PaymentSettings } from '../types/zentro';

interface RegistrationTermsViewProps {
  settings: PaymentSettings;
  mode: 'mandatory' | 'review';
  onAccept?: () => Promise<void> | void;
  onClose?: () => void;
}

export const RegistrationTermsContent: React.FC<{ settings: PaymentSettings }> = ({
  settings,
}) => {
  const items = [
    { label: 'Minimum Withdrawal', value: `${settings.minWithdrawalEtb} ETB` },
    { label: 'Minimum Recharge', value: `${settings.minRechargeEtb} ETB` },
    { label: 'Daily Check-in', value: `${settings.dailyCheckInEtb} ETB` },
    { label: 'Withdrawal Fee', value: `${settings.withdrawalFeePercent}%` },
    { label: 'Registration Bonus', value: `${settings.registrationBonusEtb} ETB` },
    { label: 'Level 1 Referral Rate', value: `${settings.level1CommissionPercent}%` },
    { label: 'Level 2 Referral Rate', value: `${settings.level2CommissionPercent}%` },
    { label: 'Level 3 Referral Rate', value: `${settings.level3CommissionPercent}%` },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 divide-y divide-slate-200/70">
        {items.map((row) => (
          <div
            key={row.label}
            className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs sm:text-sm"
          >
            <span className="text-slate-700 font-medium">{row.label}</span>
            <span className="font-mono tabular-nums font-bold text-slate-950">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-slate-800 space-y-1">
        <p className="font-semibold text-slate-950">
          Withdrawal Requirement: Purchase at least 1 plan before first withdrawal.
        </p>
        {settings.withdrawalScheduleNote && (
          <p className="text-[11px] text-slate-700">
            Schedule: {settings.withdrawalScheduleNote}
          </p>
        )}
      </div>
    </div>
  );
};

export const RegistrationTermsView: React.FC<RegistrationTermsViewProps> = ({
  settings,
  mode,
  onAccept,
  onClose,
}) => {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleAccept = async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    try {
      await onAccept?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-950 flex items-center justify-center px-4 py-8">
      <main className="w-full max-w-md space-y-5">
        <div className="flex flex-col items-center text-center gap-1.5">
          <BrandLogo size="lg" showTagline />
        </div>

        <section
          aria-label="Terms and Conditions"
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
        >
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <span className="h-9 w-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-950">
                Terms &amp; Conditions
              </h1>
              <p className="text-xs text-slate-600">
                {mode === 'mandatory'
                  ? 'Accept terms to enter ZENTRO Home'
                  : 'Platform rules summary'}
              </p>
            </div>
          </div>

          <RegistrationTermsContent settings={settings} />

          {mode === 'mandatory' ? (
            <div className="space-y-3 pt-1">
              <label
                htmlFor="terms-agree-checkbox"
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3 cursor-pointer select-none hover:border-blue-400 transition-colors"
              >
                <input
                  id="terms-agree-checkbox"
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`h-5 w-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                    agreed
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-slate-400 bg-white text-transparent'
                  }`}
                >
                  <Check className="h-3.5 w-3.5 stroke-[3]" />
                </span>
                <span className="text-xs sm:text-sm font-medium text-slate-900">
                  I have read and agree to the Terms &amp; Conditions
                </span>
              </label>

              <button
                type="button"
                disabled={!agreed || submitting}
                onClick={handleAccept}
                className={`w-full min-h-[46px] rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5 ${
                  agreed
                    ? 'bg-blue-700 hover:bg-blue-800 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                }`}
              >
                <Check className="h-4 w-4" />
                <span>{submitting ? 'Confirming...' : 'Accept'}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              Close
            </button>
          )}
        </section>
      </main>
    </div>
  );
};
