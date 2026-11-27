import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthView } from './components/AuthView';
import { BrandLogo } from './components/BrandLogo';
import { CustomerBottomNav } from './components/CustomerBottomNav';
import { CustomerModals } from './components/CustomerModals';
import { HomeView } from './components/HomeView';
import { MeView } from './components/MeView';
import { PurchasedView } from './components/PurchasedView';
import { RegistrationTermsView } from './components/RegistrationTermsView';
import { TeamView } from './components/TeamView';
import {
  apiAcceptTerms,
  apiDailyCheckIn,
  apiGetMe,
  apiGetPublicPaymentSettings,
  apiGetSession,
  apiLogout,
  apiSaveBankAccount,
  clearAuthToken,
  setAuthToken,
} from './services/api';
import {
  ActiveModal,
  AuthSessionUser,
  BankAccountInfo,
  CustomerProfilePayload,
  CustomerTab,
  PaymentSettings,
} from './types/zentro';
import {
  extractReferralCodeFromSearch,
  FALLBACK_FINANCIAL_RULES,
  VIP_PLANS,
} from './utils/zentroLogic';

const DEFAULT_PUBLIC_SETTINGS: PaymentSettings = {
  depositMethods: [],
  withdrawalMethods: [],
  withdrawalStartHour: 8,
  withdrawalEndHour: 20,
  enforceWithdrawalHours: false,
  withdrawalScheduleNote: '',
  ...FALLBACK_FINANCIAL_RULES,
  commissionBase: 'none',
  updatedAt: '',
};

export default function App() {
  const [initialReferralCode] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return extractReferralCodeFromSearch(window.location.search);
  });

  const [sessionUser, setSessionUser] = useState<AuthSessionUser | null>(null);
  const [customerProfile, setCustomerProfile] =
    useState<CustomerProfilePayload | null>(null);
  const [publicSettings, setPublicSettings] =
    useState<PaymentSettings>(DEFAULT_PUBLIC_SETTINGS);
  const [customerTab, setCustomerTab] = useState<CustomerTab>('home');
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);

  const refreshCustomerProfile = useCallback(async () => {
    const data = await apiGetMe();
    setCustomerProfile(data);
    setPublicSettings(data.paymentSettings);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [settingsRes, sessionRes] = await Promise.all([
          apiGetPublicPaymentSettings().catch(() => null),
          apiGetSession().catch(() => ({ authenticated: false as const })),
        ]);
        if (!active) return;
        if (settingsRes) {
          setPublicSettings(settingsRes);
        }
        if (sessionRes.authenticated) {
          setAuthToken(sessionRes.token);
          setSessionUser(sessionRes.user);
          if (sessionRes.user.role === 'customer') {
            setLoadingProfile(true);
            try {
              await refreshCustomerProfile();
            } finally {
              if (active) setLoadingProfile(false);
            }
          }
        }
      } finally {
        if (active) setRestoringSession(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshCustomerProfile]);

  const handleAuthSuccess = async (user: AuthSessionUser) => {
    setSessionUser(user);
    setCustomerTab('home');
    setActiveModal(null);
    if (user.role === 'customer') {
      setLoadingProfile(true);
      try {
        await refreshCustomerProfile();
      } finally {
        setLoadingProfile(false);
      }
    }
  };

  // Refresh notifications/account updates periodically while customer is signed in
  useEffect(() => {
    if (!sessionUser || sessionUser.role !== 'customer') return;
    const id = window.setInterval(() => {
      refreshCustomerProfile().catch(() => {
        // ignore background poll error
      });
    }, 15000);
    return () => window.clearInterval(id);
  }, [sessionUser, refreshCustomerProfile]);

  const handleLogout = async () => {
    await apiLogout().catch(() => {
      // Ignore network error on logout; clear client state either way
    });
    clearAuthToken();
    setSessionUser(null);
    setCustomerProfile(null);
    setActiveModal(null);
    setCustomerTab('home');
  };

  const handleAcceptTerms = async () => {
    await apiAcceptTerms();
    await refreshCustomerProfile();
  };

  const handleDailyCheckIn = async (): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await apiDailyCheckIn();
      await refreshCustomerProfile();
      return { ok: true, message: `+${res.rewardEtb} ETB claimed!` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  };

  const handleSaveBankAccount = async (account: BankAccountInfo) => {
    await apiSaveBankAccount(account);
    await refreshCustomerProfile();
  };

  const handleChangeCustomerTab = (tab: CustomerTab) => {
    setCustomerTab(tab);
    window.scrollTo({ top: 0 });
  };

  // Restoring persistent session before showing login
  if (restoringSession) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <BrandLogo size="md" showTagline />
          <p className="text-xs font-medium text-slate-600">Loading your account...</p>
        </div>
      </div>
    );
  }

  // Unauthenticated -> Centered Logo + Shared Auth Box
  if (!sessionUser) {
    return (
      <AuthView
        registrationBonusEtb={publicSettings.registrationBonusEtb}
        initialReferralCode={initialReferralCode}
        onAuthSuccess={handleAuthSuccess}
      />
    );
  }

  // Role-Based Admin Access
  if (sessionUser.role === 'admin') {
    return <AdminDashboard currentUser={sessionUser} onLogout={handleLogout} />;
  }

  // Loading customer profile
  if (loadingProfile || !customerProfile) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <BrandLogo size="md" showTagline />
          <p className="text-xs font-medium text-slate-600">Loading your account...</p>
        </div>
      </div>
    );
  }

  // Mandatory Registration Terms Gate
  if (!customerProfile.user.termsAccepted) {
    return (
      <RegistrationTermsView
        settings={customerProfile.paymentSettings}
        mode="mandatory"
        onAccept={handleAcceptTerms}
      />
    );
  }

  const unreadNotifications = customerProfile.notifications.filter(
    (n) => !n.isRead
  ).length;
  const vipPlans =
    customerProfile.vipPlans.length > 0 ? customerProfile.vipPlans : VIP_PLANS;
  const welfareEnrollments = customerProfile.welfareEnrollments ?? [];
  const totalPurchasedCount =
    customerProfile.purchasedPlans.length + welfareEnrollments.length;
  const welfareVaultEtb = welfareEnrollments
    .filter((w) => w.status === 'Active')
    .reduce((sum, w) => sum + w.accumulatedEtb, 0);

  return (
    <div className="min-h-screen bg-white text-slate-950 pb-24">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-amber-200/80 px-4 py-2.5">
        <div className="mx-auto max-w-5xl flex items-center justify-between gap-4">
          <BrandLogo size="sm" showTagline />

          <div className="flex items-center gap-3 min-w-0">
            <span className="hidden sm:block text-xs font-medium text-slate-700 truncate max-w-[160px]">
              {customerProfile.user.name}
            </span>
            <button
              type="button"
              onClick={() => setActiveModal({ type: 'notifications' })}
              aria-label={`Notifications (${unreadNotifications} unread)`}
              className="relative min-h-[40px] min-w-[40px] rounded-xl border border-amber-200 bg-amber-50/60 hover:bg-amber-100/70 text-slate-900 flex items-center justify-center cursor-pointer transition-colors shrink-0"
            >
              <Bell className="h-5 w-5 text-amber-700" />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-700 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 sm:py-5 space-y-4">
        {customerTab === 'home' && (
          <HomeView
            activeBroadcast={customerProfile.activeBroadcast}
            vipPlans={vipPlans}
            welfarePlans={customerProfile.welfarePlans}
            walletBalanceEtb={customerProfile.user.walletBalanceEtb}
            welfareVaultEtb={welfareVaultEtb}
            onOpenModal={setActiveModal}
          />
        )}

        {customerTab === 'purchased' && (
          <PurchasedView
            records={customerProfile.purchasedPlans}
            welfareEnrollments={welfareEnrollments}
            activities={customerProfile.activities}
            onRefreshMe={refreshCustomerProfile}
          />
        )}

        {customerTab === 'team' && (
          <TeamView
            currentUser={customerProfile.user}
            members={customerProfile.teamMembers}
            settings={customerProfile.paymentSettings}
          />
        )}

        {customerTab === 'me' && (
          <MeView
            currentUser={customerProfile.user}
            purchasedCount={totalPurchasedCount}
            welfareVaultEtb={welfareVaultEtb}
            checkInHistory={customerProfile.checkInHistory}
            deposits={customerProfile.deposits}
            withdrawals={customerProfile.withdrawals}
            settings={customerProfile.paymentSettings}
            onNavigateTab={handleChangeCustomerTab}
            onOpenModal={setActiveModal}
            onDailyCheckIn={handleDailyCheckIn}
            onSaveBankAccount={handleSaveBankAccount}
            onLogout={handleLogout}
          />
        )}
      </main>

      <CustomerBottomNav
        activeTab={customerTab}
        onChangeTab={handleChangeCustomerTab}
      />

      <CustomerModals
        modal={activeModal}
        currentUser={customerProfile.user}
        purchasedCount={totalPurchasedCount}
        settings={customerProfile.paymentSettings}
        notifications={customerProfile.notifications}
        onClose={() => setActiveModal(null)}
        onRefreshMe={refreshCustomerProfile}
      />
    </div>
  );
}
