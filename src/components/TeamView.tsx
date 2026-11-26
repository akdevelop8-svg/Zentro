import React, { useState } from 'react';
import { Check, Copy, Link2, UserPlus, Users } from 'lucide-react';
import { CustomerAccount, PaymentSettings, TeamMember } from '../types/zentro';
import {
  buildReferralLink,
  filterTeamByLevel,
  REFERRAL_BASE_URL,
  summarizeTeamHierarchy,
} from '../utils/zentroLogic';

interface TeamViewProps {
  currentUser: CustomerAccount;
  members: TeamMember[];
  settings: PaymentSettings;
}

export const TeamView: React.FC<TeamViewProps> = ({
  currentUser,
  members,
  settings,
}) => {
  const [selectedLevel, setSelectedLevel] = useState<1 | 2 | 3>(1);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const summary = summarizeTeamHierarchy(members);
  const visibleMembers = filterTeamByLevel(members, selectedLevel);
  const referralUrl = buildReferralLink(currentUser.invitationCode, REFERRAL_BASE_URL);

  const copyText = async (text: string, type: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Safe fallback when clipboard API is restricted
    }
    if (type === 'code') {
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const levelTabs: { level: 1 | 2 | 3; label: string; count: number; pct: number }[] = [
    {
      level: 1,
      label: 'Level 1',
      count: summary.level1Count,
      pct: settings.level1CommissionPercent,
    },
    {
      level: 2,
      label: 'Level 2',
      count: summary.level2Count,
      pct: settings.level2CommissionPercent,
    },
    {
      level: 3,
      label: 'Level 3',
      count: summary.level3Count,
      pct: settings.level3CommissionPercent,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-950">
            Team
          </h1>
          <p className="text-xs text-slate-600">
            Referral hierarchy · L1 {settings.level1CommissionPercent}% · L2{' '}
            {settings.level2CommissionPercent}% · L3 {settings.level3CommissionPercent}%
          </p>
        </div>
        <span className="font-mono tabular-nums text-xs font-semibold text-blue-800">
          {summary.totalMembers} Members
        </span>
      </div>

      {/* Invitation Code & Referral Link Card */}
      <section
        aria-label="Invitation code and referral link"
        className="rounded-2xl border border-amber-200 bg-blue-50/40 p-4 sm:p-5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-blue-900">Invitation Code</p>
            <p className="font-mono tabular-nums text-xl font-bold text-slate-950">
              {currentUser.invitationCode}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => copyText(currentUser.invitationCode, 'code')}
              className="min-h-[42px] px-3.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              {copiedCode ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
            </button>
            <button
              type="button"
              onClick={() => copyText(referralUrl, 'link')}
              className="min-h-[42px] px-3.5 rounded-xl border border-blue-700 bg-white hover:bg-blue-50 text-blue-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
              <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
            </button>
          </div>
        </div>

        <p className="text-[11px] font-mono text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2 truncate">
          {referralUrl}
        </p>
      </section>

      {/* Level 1, Level 2, Level 3 Selectable Tabs */}
      <section aria-label="Team levels" className="space-y-3">
        <div
          role="tablist"
          aria-label="Referral level filter"
          className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100"
        >
          {levelTabs.map((tab) => {
            const active = selectedLevel === tab.level;
            return (
              <button
                key={tab.level}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedLevel(tab.level)}
                className={`min-h-[44px] px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            );
          })}
        </div>

        {/* Selected Level Member List */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-950">
              <Users className="h-4 w-4 text-blue-700" />
              <span>Level {selectedLevel} Members</span>
            </span>
            <span className="text-amber-700 font-semibold">
              {levelTabs[selectedLevel - 1].pct}% Commission
            </span>
          </div>

          {visibleMembers.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-600">
              No members in Level {selectedLevel}.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleMembers.map((member) => (
                <div
                  key={member.id}
                  className="px-4 py-3 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-8 w-8 rounded-xl bg-slate-100 text-blue-700 flex items-center justify-center shrink-0">
                      <UserPlus className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-950 truncate">
                        {member.name}
                      </p>
                      <p className="text-[11px] text-slate-600 font-mono truncate">
                        {member.phone} · Via {member.invitedBy}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-blue-800">{member.tier}</p>
                    <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {member.registeredAt}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
