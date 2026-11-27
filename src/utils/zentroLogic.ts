import {
  BankAccountInfo,
  BannerSlide,
  TeamMember,
  VipPlan,
  WelfareEnrollmentRecord,
  WelfarePlan,
} from '../types/zentro';

export const MAIN_ZENTRO_LOGO = '/assets/aistudio/IMG_20261125_213001_406_931e779b.jpg';

export const ROTATING_BANNER_SLIDES: BannerSlide[] = [
  {
    id: 'banner-1',
    title: 'ZENTRO — Beyond Limits',
    subtitle: 'Innovation, Teamwork & Opportunity',
    imageSrc: '/assets/aistudio/IMG_20261125_213001_411_299bfd26.jpg',
    alt: 'ZENTRO metallic emblem illuminated banner',
  },
  {
    id: 'banner-2',
    title: 'Dream • Work • Earn',
    subtitle: 'Building a Community of Progress',
    imageSrc: '/assets/aistudio/IMG_20261125_213000_589_7640d707.jpg',
    alt: 'ZENTRO Beyond Limits gold and silver billboard',
  },
  {
    id: 'banner-3',
    title: 'Your Success, Our Priority',
    subtitle: 'Transparency, Trust & Excellence',
    imageSrc: '/assets/aistudio/IMG_20261125_213000_513_722f0b4f.jpg',
    alt: 'ZENTRO executive monogram banner',
  },
];

export const REFERRAL_BASE_URL =
  typeof window !== 'undefined'
    ? `${window.location.origin}/?ref=`
    : 'https://zentro.example/?ref=';

export const FALLBACK_FINANCIAL_RULES = {
  minWithdrawalEtb: 150,
  minRechargeEtb: 700,
  withdrawalFeePercent: 17,
  registrationBonusEtb: 150,
  dailyCheckInEtb: 5,
  level1CommissionPercent: 15,
  level2CommissionPercent: 2,
  level3CommissionPercent: 1,
};

export const VIP_PLANS: VipPlan[] = [
  {
    id: 'vip-1',
    tier: 'VIP 1',
    level: 1,
    label: 'Starter',
    investmentEtb: 700,
    dailyIncomeEtb: 130,
    cycleDays: 30,
  },
  {
    id: 'vip-2',
    tier: 'VIP 2',
    level: 2,
    label: 'Standard',
    investmentEtb: 1500,
    dailyIncomeEtb: 300,
    cycleDays: 30,
  },
  {
    id: 'vip-3',
    tier: 'VIP 3',
    level: 3,
    label: 'Growth',
    investmentEtb: 3000,
    dailyIncomeEtb: 600,
    cycleDays: 30,
  },
  {
    id: 'vip-4',
    tier: 'VIP 4',
    level: 4,
    label: 'Executive',
    investmentEtb: 5000,
    dailyIncomeEtb: 900,
    cycleDays: 30,
  },
  {
    id: 'vip-5',
    tier: 'VIP 5',
    level: 5,
    label: 'Premier',
    investmentEtb: 15000,
    dailyIncomeEtb: 2000,
    cycleDays: 30,
  },
  {
    id: 'vip-6',
    tier: 'VIP 6',
    level: 6,
    label: 'Apex',
    investmentEtb: 25000,
    dailyIncomeEtb: 5000,
    cycleDays: 30,
  },
];

export const WELFARE_PLANS: WelfarePlan[] = [
  {
    id: 'welfare-1',
    name: 'Plan 1',
    investmentEtb: 3000,
    dailyAmountEtb: 1000,
    durationDays: 5,
  },
  {
    id: 'welfare-2',
    name: 'Plan 2',
    investmentEtb: 5000,
    dailyAmountEtb: 1500,
    durationDays: 5,
  },
  {
    id: 'welfare-3',
    name: 'Plan 3',
    investmentEtb: 10000,
    dailyAmountEtb: 3000,
    durationDays: 5,
  },
  {
    id: 'welfare-4',
    name: 'Plan 4',
    investmentEtb: 15000,
    dailyAmountEtb: 4000,
    durationDays: 7,
  },
  {
    id: 'welfare-5',
    name: 'Plan 5',
    investmentEtb: 25000,
    dailyAmountEtb: 7000,
    durationDays: 7,
  },
];

/** Calculates the planned total profit from a daily amount and plan duration. */
export function calculateTotalProfitEtb(dailyProfitEtb: number, dayLength: number): number {
  if (
    !Number.isFinite(dailyProfitEtb) ||
    !Number.isInteger(dayLength) ||
    dailyProfitEtb < 0 ||
    dayLength < 0
  ) {
    return 0;
  }
  return Math.round(dailyProfitEtb * dayLength * 100) / 100;
}

const DAY_MS = 24 * 3600 * 1000;

export function formatCountdown(totalSeconds: number): {
  hours: string;
  minutes: string;
  seconds: string;
  formatted: string;
  progressPercent: number;
} {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  const totalDaySeconds = 24 * 3600;
  const elapsed = totalDaySeconds - Math.min(clamped, totalDaySeconds);
  const progressPercent = Math.round((elapsed / totalDaySeconds) * 100);

  return {
    hours: pad(hrs),
    minutes: pad(mins),
    seconds: pad(secs),
    formatted: `${pad(hrs)}:${pad(mins)}:${pad(secs)}`,
    progressPercent,
  };
}

export function formatMultiDayCountdown(
  remainingSeconds: number,
  totalDurationDays: number
): {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
  formatted: string;
  progressPercent: number;
} {
  const totalSec = Math.max(1, Math.floor(totalDurationDays) * 24 * 3600);
  const clamped = Math.max(0, Math.min(totalSec, Math.floor(remainingSeconds)));
  const daysNum = Math.floor(clamped / 86400);
  const hrs = Math.floor((clamped % 86400) / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  const elapsed = totalSec - clamped;
  const progressPercent = Math.round((elapsed / totalSec) * 100);

  return {
    days: String(daysNum),
    hours: pad(hrs),
    minutes: pad(mins),
    seconds: pad(secs),
    formatted: `${daysNum}d ${pad(hrs)}:${pad(mins)}:${pad(secs)}`,
    progressPercent,
  };
}

export function buildReferralLink(invitationCode: string, baseUrl: string): string {
  return `${baseUrl}${encodeURIComponent(invitationCode.trim())}`;
}

export function extractReferralCodeFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  const raw = params.get('ref') ?? '';
  return raw.replace(/[^0-9A-Za-z_-]/g, '').trim();
}

export function getCheckInStatus(
  lastCheckInAt: number | null,
  nowMs: number,
  registeredAt: string | number
): {
  canClaim: boolean;
  remainingSeconds: number;
  formattedRemaining: string;
} {
  // The first check-in is available 24 hours after registration.
  // Later check-ins are available 24 hours after the previous successful claim.
  const registeredAtMs =
    typeof registeredAt === 'number' ? registeredAt : Date.parse(registeredAt);
  const nextClaimAtMs =
    lastCheckInAt !== null
      ? lastCheckInAt + DAY_MS
      : Number.isFinite(registeredAtMs)
        ? registeredAtMs + DAY_MS
        : Number.POSITIVE_INFINITY;
  const remainingMs = Math.max(0, nextClaimAtMs - nowMs);

  if (remainingMs === 0) {
    return {
      canClaim: true,
      remainingSeconds: 0,
      formattedRemaining: '00:00:00',
    };
  }

  // If the registration timestamp is unavailable, fail closed rather than
  // allowing an immediate first claim.
  const remainingSeconds = Number.isFinite(remainingMs)
    ? Math.ceil(remainingMs / 1000)
    : 24 * 60 * 60;
  return {
    canClaim: false,
    remainingSeconds,
    formattedRemaining: formatCountdown(remainingSeconds).formatted,
  };
}

export function getWelfareClaimState(
  enrollment: WelfareEnrollmentRecord,
  nowMs: number
): {
  currentDay: number;
  isMatured: boolean;
  maturityRemainingSeconds: number;
  canClaimDaily: boolean;
  nextClaimRemainingSeconds: number;
  canReleaseToWallet: boolean;
  totalExpectedEtb: number;
} {
  const elapsedFromStart = Math.max(0, nowMs - enrollment.startedAtMs);
  const currentDay = Math.min(
    enrollment.durationDays,
    Math.floor(elapsedFromStart / DAY_MS) + 1
  );
  const maturityRemainingSeconds = Math.max(
    0,
    Math.ceil((enrollment.maturesAtMs - nowMs) / 1000)
  );
  const isMatured = nowMs >= enrollment.maturesAtMs;
  const hasRemainingDays = enrollment.claimedDays < enrollment.durationDays;

  // The first Welfare claim also has to wait 24 hours from activation.
  // Later claims wait 24 hours from the previous successful claim.
  const claimAnchorMs = enrollment.lastClaimAtMs ?? enrollment.startedAtMs;
  const elapsedSinceClaimAnchor = Math.max(0, nowMs - claimAnchorMs);
  const cooldownPassed = elapsedSinceClaimAnchor >= DAY_MS;
  const nextClaimRemainingSeconds = cooldownPassed
    ? 0
    : Math.ceil((DAY_MS - elapsedSinceClaimAnchor) / 1000);

  const isActive = enrollment.status === 'Active';
  const canClaimDaily = isActive && hasRemainingDays && cooldownPassed;
  const canReleaseToWallet =
    isActive &&
    isMatured &&
    enrollment.claimedDays >= enrollment.durationDays &&
    enrollment.accumulatedEtb > 0;
  const totalExpectedEtb = calculateTotalProfitEtb(enrollment.dailyAmountEtb, enrollment.durationDays);

  return {
    currentDay,
    isMatured,
    maturityRemainingSeconds,
    canClaimDaily,
    nextClaimRemainingSeconds,
    canReleaseToWallet,
    totalExpectedEtb,
  };
}

export function canRequestWithdrawal(purchasedPlansCount: number): boolean {
  return purchasedPlansCount > 0;
}

export function calculateWithdrawalPreview(
  amountEtb: number,
  feePercent: number
): { feeEtb: number; netAmountEtb: number } {
  if (!Number.isFinite(amountEtb) || amountEtb <= 0) {
    return { feeEtb: 0, netAmountEtb: 0 };
  }
  const feeEtb = Math.round((amountEtb * feePercent) / 100);
  const netAmountEtb = Math.max(0, amountEtb - feeEtb);
  return { feeEtb, netAmountEtb };
}

export function validateBankAccount(
  input: BankAccountInfo
): { ok: true; account: BankAccountInfo } | { ok: false; error: string } {
  const accountName = input.accountName.trim();
  const accountNumber = input.accountNumber.replace(/\s+/g, '');
  const method = input.method.trim() || 'CBE';
  if (accountName.length < 2) {
    return { ok: false, error: 'Enter account holder name.' };
  }
  if (!/^\d{8,18}$/.test(accountNumber)) {
    return { ok: false, error: 'Account number must be 8–18 digits.' };
  }
  return {
    ok: true,
    account: {
      accountName,
      accountNumber,
      method,
    },
  };
}

export function normalizePhone(raw: string): string {
  const cleaned = raw.trim().replace(/[\s\-()]/g, '');
  if (!cleaned) return '';
  if (/^\+?251(9|7)\d{8}$/.test(cleaned)) {
    return `251${cleaned.replace(/^\+?251/, '')}`;
  }
  if (/^0(9|7)\d{8}$/.test(cleaned)) {
    return `251${cleaned.slice(1)}`;
  }
  if (/^(9|7)\d{8}$/.test(cleaned)) {
    return `251${cleaned}`;
  }
  return cleaned.toLowerCase();
}

export function summarizeTeamHierarchy(members: TeamMember[]): {
  totalMembers: number;
  level1Count: number;
  level2Count: number;
  level3Count: number;
  level1Members: TeamMember[];
  level2Members: TeamMember[];
  level3Members: TeamMember[];
} {
  const level1Members = members.filter((m) => m.level === 1);
  const level2Members = members.filter((m) => m.level === 2);
  const level3Members = members.filter((m) => m.level === 3);
  return {
    totalMembers: members.length,
    level1Count: level1Members.length,
    level2Count: level2Members.length,
    level3Count: level3Members.length,
    level1Members,
    level2Members,
    level3Members,
  };
}

export function filterTeamByLevel(
  members: TeamMember[],
  level: 1 | 2 | 3
): TeamMember[] {
  return members.filter((m) => m.level === level);
}

export function fileToBase64DataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read file.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read selected image.'));
    reader.readAsDataURL(file);
  });
}
