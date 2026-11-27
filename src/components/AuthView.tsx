import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  KeyRound,
  Lock,
  Phone,
  ShieldCheck,
  User,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import {
  apiBootstrapAdmin,
  apiGetAdminBootstrapStatus,
  apiLogin,
  apiRegister,
} from '../services/api';
import { AuthSessionUser } from '../types/zentro';

interface AuthViewProps {
  registrationBonusEtb: number;
  initialReferralCode?: string;
  onAuthSuccess: (user: AuthSessionUser) => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  registrationBonusEtb,
  initialReferralCode = '',
  onAuthSuccess,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(
    initialReferralCode ? 'register' : 'login'
  );

  // Login state (same page for Customer and Admin)
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Registration state (Customer only)
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regInvite, setRegInvite] = useState(initialReferralCode);
  const [regError, setRegError] = useState<string | null>(null);
  const [regLoading, setRegLoading] = useState(false);

  // One-time First-Run Admin Setup (shown only when server ADMIN_PASSWORD is not configured)
  const [adminBootstrap, setAdminBootstrap] = useState<{
    configured: boolean;
    adminUsername: string;
  } | null>(null);
  const [showAdminSetup, setShowAdminSetup] = useState(false);
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSuccess, setSetupSuccess] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);

  useEffect(() => {
    if (initialReferralCode) {
      setMode('register');
      setRegInvite(initialReferralCode);
    }
  }, [initialReferralCode]);

  useEffect(() => {
    let active = true;
    apiGetAdminBootstrapStatus()
      .then((res) => {
        if (active) setAdminBootstrap(res);
      })
      .catch(() => {
        // Ignore transient status failure
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!loginIdentifier.trim() || !loginPassword) {
      setLoginError('Enter your name or phone number and password.');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await apiLogin(loginIdentifier.trim(), loginPassword);
      onAuthSuccess(res.user);
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    setRegLoading(true);
    try {
      const res = await apiRegister({
        name: regName.trim(),
        phone: regPhone.trim(),
        password: regPassword,
        confirmPassword: regConfirm,
        invitationCode: regInvite.trim(),
      });
      onAuthSuccess(res.user);
    } catch (err) {
      setRegError((err as Error).message);
    } finally {
      setRegLoading(false);
    }
  };

  const handleAdminSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);
    setSetupLoading(true);
    try {
      await apiBootstrapAdmin(setupPassword, setupConfirm);
      setSetupSuccess(
        `Admin access configured for "${adminBootstrap?.adminUsername ?? 'Zentro'}". You can now sign in above.`
      );
      setAdminBootstrap((prev) => (prev ? { ...prev, configured: true } : prev));
      setShowAdminSetup(false);
      setSetupPassword('');
      setSetupConfirm('');
    } catch (err) {
      setSetupError((err as Error).message);
    } finally {
      setSetupLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-950 flex items-center justify-center px-4 py-8">
      <main className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center gap-1.5">
          <BrandLogo size="lg" showTagline />
        </div>

        <section
          aria-label="Authentication"
          className="rounded-3xl border border-amber-200/90 bg-white p-6 sm:p-7 shadow-sm space-y-5 relative overflow-hidden"
        >
          <div
            aria-hidden="true"
            className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-300 via-yellow-500 to-amber-400"
          />

          <div
            role="tablist"
            aria-label="Authentication mode"
            className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => {
                setMode('login');
                setLoginError(null);
              }}
              className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-white text-blue-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              Login
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => {
                setMode('register');
                setRegError(null);
              }}
              className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'register'
                  ? 'bg-white text-blue-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              Register
            </button>
          </div>

          {setupSuccess && (
            <div
              role="status"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800"
            >
              {setupSuccess}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-semibold text-slate-800 mb-1.5"
                >
                  Name / Phone Number
                </label>
                <div className="relative">
                  <User className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-identifier"
                    type="text"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder="Name or phone number"
                    autoComplete="username"
                    className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold text-slate-800 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                    className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              {loginError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700"
                >
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span>{loginLoading ? 'Signing in...' : 'Login'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5" noValidate>
              <div>
                <label
                  htmlFor="reg-name"
                  className="block text-xs font-semibold text-slate-800 mb-1"
                >
                  Name
                </label>
                <div className="relative">
                  <User className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="reg-name"
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Full name"
                    className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-phone"
                  className="block text-xs font-semibold text-slate-800 mb-1"
                >
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="reg-phone"
                    type="tel"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    placeholder="+2519XXXXXXXX"
                    className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="reg-password"
                    className="block text-xs font-semibold text-slate-800 mb-1"
                  >
                    Password
                  </label>
                  <input
                    id="reg-password"
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Min 6 chars"
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label
                    htmlFor="reg-confirm"
                    className="block text-xs font-semibold text-slate-800 mb-1"
                  >
                    Confirm Password
                  </label>
                  <input
                    id="reg-confirm"
                    type="password"
                    value={regConfirm}
                    onChange={(e) => setRegConfirm(e.target.value)}
                    placeholder="Repeat"
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-invite"
                  className="block text-xs font-semibold text-slate-800 mb-1"
                >
                  Referral Code{' '}
                  <span className="font-normal text-slate-500">
                    {initialReferralCode
                      ? '(Auto-filled from referral link)'
                      : '(Optional — not required to register)'}
                  </span>
                </label>
                <div className="relative">
                  <KeyRound className="h-4 w-4 text-amber-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="reg-invite"
                    type="text"
                    inputMode="numeric"
                    readOnly={Boolean(initialReferralCode)}
                    value={regInvite}
                    onChange={(e) => {
                      if (!initialReferralCode) setRegInvite(e.target.value);
                    }}
                    placeholder="Optional"
                    className={`w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                      initialReferralCode
                        ? 'border-blue-200 bg-blue-50/50 text-blue-900 font-semibold'
                        : 'border-slate-200 bg-white text-slate-950 placeholder:text-slate-400'
                    }`}
                  />
                </div>
              </div>

              {regError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700"
                >
                  {regError}
                </div>
              )}

              <button
                type="submit"
                disabled={regLoading}
                className="w-full min-h-[46px] rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span>{regLoading ? 'Creating account...' : 'Register'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}

          {/* One-time initial Admin password claim when server ADMIN_PASSWORD env is unset */}
          {adminBootstrap && !adminBootstrap.configured && (
            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowAdminSetup((v) => !v);
                  setSetupError(null);
                }}
                className="w-full flex items-center justify-between text-xs font-semibold text-amber-800 hover:text-amber-950 cursor-pointer py-1"
              >
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-amber-600" />
                  <span>First-Run Admin Setup ({adminBootstrap.adminUsername})</span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    showAdminSetup ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {showAdminSetup && (
                <form
                  onSubmit={handleAdminSetupSubmit}
                  className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-2.5"
                >
                  <p className="text-[11px] text-slate-700">
                    Set the initial password for admin account{' '}
                    <span className="font-mono font-bold text-slate-950">
                      {adminBootstrap.adminUsername}
                    </span>
                    . This can only be done once.
                  </p>
                  <input
                    type="password"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder="Admin password (min 8 chars)"
                    className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-950"
                  />
                  <input
                    type="password"
                    value={setupConfirm}
                    onChange={(e) => setSetupConfirm(e.target.value)}
                    placeholder="Confirm admin password"
                    className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-950"
                  />
                  {setupError && (
                    <p role="alert" className="text-[11px] font-medium text-red-700">
                      {setupError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={setupLoading}
                    className="w-full min-h-[40px] rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    {setupLoading ? 'Saving...' : 'Initialize Admin Password'}
                  </button>
                </form>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
