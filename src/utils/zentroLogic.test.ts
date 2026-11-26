import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReferralLink,
  calculateWithdrawalPreview,
  canRequestWithdrawal,
  extractReferralCodeFromSearch,
  filterTeamByLevel,
  formatCountdown,
  formatMultiDayCountdown,
  getCheckInStatus,
  getWelfareClaimState,
  normalizePhone,
  summarizeTeamHierarchy,
  validateBankAccount,
  VIP_PLANS,
  WELFARE_PLANS,
} from './zentroLogic';
import type { TeamMember, WelfareEnrollmentRecord } from '../types/zentro';

test('VIP_PLANS match exact final specifications', () => {
  assert.equal(VIP_PLANS.length, 6);
  assert.deepEqual(
    VIP_PLANS.map((p) => [p.tier, p.investmentEtb, p.dailyIncomeEtb, p.cycleDays]),
    [
      ['VIP 1', 700, 130, 30],
      ['VIP 2', 1500, 300, 30],
      ['VIP 3', 3000, 600, 30],
      ['VIP 4', 5000, 900, 30],
      ['VIP 5', 15000, 2000, 30],
      ['VIP 6', 25000, 5000, 30],
    ]
  );
});

test('WELFARE_PLANS match exact 5-plan specifications', () => {
  assert.equal(WELFARE_PLANS.length, 5);
  assert.deepEqual(
    WELFARE_PLANS.map((p) => [p.name, p.investmentEtb, p.dailyAmountEtb, p.durationDays]),
    [
      ['Plan 1', 3000, 1000, 5],
      ['Plan 2', 5000, 1500, 5],
      ['Plan 3', 10000, 3000, 5],
      ['Plan 4', 15000, 4000, 7],
      ['Plan 5', 25000, 7000, 7],
    ]
  );
});

test('formatMultiDayCountdown formats 5-day and 7-day remaining durations accurately', () => {
  const full5 = formatMultiDayCountdown(5 * 86400, 5);
  assert.equal(full5.formatted, '5d 00:00:00');
  assert.equal(full5.progressPercent, 0);

  const partial7 = formatMultiDayCountdown(6 * 86400 + 3661, 7);
  assert.equal(partial7.formatted, '6d 01:01:01');

  const done = formatMultiDayCountdown(0, 5);
  assert.equal(done.formatted, '0d 00:00:00');
  assert.equal(done.progressPercent, 100);
});

test('withdrawal requirement requires at least one purchased plan and calculates 17% fee', () => {
  assert.equal(canRequestWithdrawal(0), false);
  assert.equal(canRequestWithdrawal(1), true);
  assert.deepEqual(calculateWithdrawalPreview(1000, 17), {
    feeEtb: 170,
    netAmountEtb: 830,
  });
});

test('formatCountdown formats HH:MM:SS and progress percentage accurately', () => {
  const full = formatCountdown(24 * 3600);
  assert.equal(full.formatted, '24:00:00');
  assert.equal(full.progressPercent, 0);

  const half = formatCountdown(12 * 3600);
  assert.equal(half.formatted, '12:00:00');
  assert.equal(half.progressPercent, 50);

  const clamped = formatCountdown(-15);
  assert.equal(clamped.formatted, '00:00:00');
  assert.equal(clamped.progressPercent, 100);
});

test('referral URL and phone normalization helpers work accurately', () => {
  assert.equal(
    buildReferralLink('482190', 'https://zentro.example/?ref='),
    'https://zentro.example/?ref=482190'
  );
  assert.equal(extractReferralCodeFromSearch('?ref=482190'), '482190');
  assert.equal(extractReferralCodeFromSearch(''), '');
  assert.equal(normalizePhone('0911223344'), '251911223344');
  assert.equal(normalizePhone('+251911223344'), '251911223344');
});

test('daily check-in 24-hour gating locks claim for 24h and unlocks after 24h', () => {
  const t0 = 1_700_000_000_000;
  const before = getCheckInStatus(null, t0);
  assert.equal(before.canClaim, true);

  const locked = getCheckInStatus(t0, t0 + 3600_000);
  assert.equal(locked.canClaim, false);
  assert.equal(locked.formattedRemaining, '23:00:00');

  const after24h = getCheckInStatus(t0, t0 + 24 * 3600_000);
  assert.equal(after24h.canClaim, true);
});

test('validateBankAccount enforces CBE name and 8-18 digit number', () => {
  assert.equal(
    validateBankAccount({ accountName: 'Abebe', accountNumber: '123', method: 'CBE' }).ok,
    false
  );
  assert.equal(
    validateBankAccount({
      accountName: 'Abebe Bikila',
      accountNumber: '1000234567891',
      method: 'CBE',
    }).ok,
    true
  );
});

test('summarizeTeamHierarchy and filterTeamByLevel split Levels 1, 2, 3', () => {
  const members: TeamMember[] = [
    { id: '1', name: 'A', phone: '1', registeredAt: '2026-11-01', tier: 'VIP 1', level: 1, invitedBy: 'Root' },
    { id: '2', name: 'B', phone: '2', registeredAt: '2026-11-02', tier: 'VIP 1', level: 2, invitedBy: 'A' },
    { id: '3', name: 'C', phone: '3', registeredAt: '2026-11-03', tier: 'VIP 2', level: 3, invitedBy: 'B' },
  ];
  const summary = summarizeTeamHierarchy(members);
  assert.equal(summary.totalMembers, 3);
  assert.equal(filterTeamByLevel(members, 1).length, 1);
  assert.equal(filterTeamByLevel(members, 2).length, 1);
  assert.equal(filterTeamByLevel(members, 3).length, 1);
});

test('getWelfareClaimState locks accumulated savings until maturity day and enforces 24h claims', () => {
  const start = 1_700_000_000_000;
  const fiveDaysMs = 5 * 24 * 3600 * 1000;
  const enrollment: WelfareEnrollmentRecord = {
    id: 'wel-1',
    planId: 'welfare-1',
    planName: 'Plan 1',
    investmentEtb: 3000,
    dailyAmountEtb: 1000,
    durationDays: 5,
    claimedDays: 1,
    accumulatedEtb: 1000,
    startedAt: '2026-11-26',
    startedAtMs: start,
    maturesAtMs: start + fiveDaysMs,
    lastClaimAtMs: start + 1000,
    status: 'Active',
  };

  // Within first 24h: Day 1 of 5, cannot claim again, cannot release to wallet early
  const within24h = getWelfareClaimState(enrollment, start + 3600_000);
  assert.equal(within24h.currentDay, 1);
  assert.equal(within24h.canClaimDaily, false);
  assert.equal(within24h.isMatured, false);
  assert.equal(within24h.canReleaseToWallet, false);
  assert.equal(within24h.totalExpectedEtb, 5000);

  // Day 2 (after 24h, before Day 5): Day 2 of 5, can claim to separate vault, still locked from wallet withdrawal
  const day2 = getWelfareClaimState(enrollment, start + 25 * 3600_000);
  assert.equal(day2.currentDay, 2);
  assert.equal(day2.canClaimDaily, true);
  assert.equal(day2.canReleaseToWallet, false);

  // Day 5 maturity reached: Day 5 of 5, accumulated savings can safely release to main wallet
  const matured = getWelfareClaimState(enrollment, start + fiveDaysMs);
  assert.equal(matured.currentDay, 5);
  assert.equal(matured.isMatured, true);
  assert.equal(matured.canReleaseToWallet, true);
});
