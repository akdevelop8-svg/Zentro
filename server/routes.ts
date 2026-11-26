import crypto from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  getAdminUsername,
  getEnvAdminPassword,
  hashPassword,
  issueToken,
  normalizePhone,
  registerSessionSecretProvider,
  verifyPassword,
  verifyPlaintextConstantTime,
  verifyToken,
} from './auth.ts';
import type { AuthTokenPayload } from './auth.ts';
import {
  getDb,
  getPaymentSettings,
  nowTimestamp,
  SERVER_VIP_PLANS,
  SERVER_WELFARE_PLANS,
} from './db.ts';
import type { PaymentMethodConfig } from './db.ts';
import { resolveUploadFile, saveValidatedBase64Image } from './uploads.ts';

interface AuthenticatedRequest extends Request {
  auth?: AuthTokenPayload;
}

const SESSION_COOKIE_NAME = 'zentro_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600;

function parseCookieValue(req: Request, name: string): string | null {
  const rawCookie = req.headers.cookie;
  if (!rawCookie) return null;
  for (const part of rawCookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      const val = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return null;
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
  ];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
  ];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function verifyCsrfForCookieMutation(req: Request): boolean {
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return true;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }
  if (payload.role === 'customer') {
    const db = getDb();
    const row = db
      .prepare('SELECT status FROM users WHERE id = ?')
      .get(payload.userId) as { status?: string } | undefined;
    if (!row || row.status === 'Suspended') {
      res.status(403).json({ error: 'Account suspended or unavailable.' });
      return;
    }
  }
  req.auth = payload;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.auth || req.auth.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }
  next();
}

function insertAuditLog(
  actor: string,
  action: string,
  target: string,
  details?: string
): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO audit_logs (id, actor, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    `aud-${crypto.randomUUID().slice(0, 8)}`,
    actor,
    action,
    target,
    details ?? null,
    nowTimestamp()
  );
}

function insertNotification(
  userId: string,
  title: string,
  message: string,
  type: string,
  imageFilename?: string | null
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO notifications (id, user_id, title, message, image_filename, type, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    `ntf-${crypto.randomUUID().slice(0, 8)}`,
    userId,
    title,
    message,
    imageFilename ?? null,
    type,
    nowTimestamp()
  );
}

function releaseMaturedWelfarePlansForUser(userId: string, nowMs = Date.now()): void {
  const db = getDb();
  const matured = db
    .prepare(
      `SELECT id, plan_name, accumulated_etb, duration_days, claimed_days
       FROM welfare_enrollments
       WHERE user_id = ? AND status = 'Active' AND matures_at_ms <= ? AND claimed_days >= duration_days`
    )
    .all(userId, nowMs) as {
    id: string;
    plan_name: string;
    accumulated_etb: number;
    duration_days: number;
    claimed_days: number;
  }[];

  if (matured.length === 0) return;

  try {
    db.exec('BEGIN IMMEDIATE');
    const releasedAt = nowTimestamp();
    for (const row of matured) {
      const current = db
        .prepare(
          "SELECT status, accumulated_etb FROM welfare_enrollments WHERE id = ? AND user_id = ? AND status = 'Active'"
        )
        .get(row.id, userId) as { status: string; accumulated_etb: number } | undefined;
      if (!current) continue;

      if (current.accumulated_etb > 0) {
        db.prepare(
          'UPDATE users SET wallet_balance_etb = wallet_balance_etb + ? WHERE id = ?'
        ).run(current.accumulated_etb, userId);
      }

      db.prepare(
        "UPDATE welfare_enrollments SET status = 'Completed', released_at = ? WHERE id = ? AND user_id = ?"
      ).run(releasedAt, row.id, userId);

      db.prepare(
        'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        `act-${crypto.randomUUID().slice(0, 8)}`,
        userId,
        `Welfare ${row.plan_name} Matured (+${current.accumulated_etb.toLocaleString()} ETB to Wallet)`,
        row.plan_name,
        'Completed',
        releasedAt
      );

      insertNotification(
        userId,
        `Welfare ${row.plan_name} Released to Wallet`,
        `Your ${row.duration_days}-day Welfare Plan matured. ${current.accumulated_etb.toLocaleString()} ETB has moved into your main Wallet and is now ready for withdrawal.`,
        'welfare'
      );
    }
    db.exec('COMMIT');
  } catch {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
  }
}

function computeCustomerTeam(userInviteCode: string) {
  const db = getDb();
  const allCustomers = db
    .prepare(
      'SELECT id, name, phone, invitation_code, invited_by_code, created_at FROM users WHERE role = ?'
    )
    .all('customer') as {
    id: string;
    name: string;
    phone: string;
    invitation_code: string;
    invited_by_code: string | null;
    created_at: string;
  }[];

  const byCode = new Map<string, (typeof allCustomers)[number]>();
  for (const u of allCustomers) {
    byCode.set(u.invitation_code, u);
  }

  const getUserPlanTier = (userId: string): string => {
    const plan = db
      .prepare('SELECT tier FROM purchased_plans WHERE user_id = ? ORDER BY rowid DESC LIMIT 1')
      .get(userId) as { tier?: string } | undefined;
    return plan?.tier ?? 'Member';
  };

  const level1 = allCustomers.filter((u) => u.invited_by_code === userInviteCode);
  const l1Codes = new Set(level1.map((u) => u.invitation_code));
  const level2 = allCustomers.filter(
    (u) => u.invited_by_code && l1Codes.has(u.invited_by_code)
  );
  const l2Codes = new Set(level2.map((u) => u.invitation_code));
  const level3 = allCustomers.filter(
    (u) => u.invited_by_code && l2Codes.has(u.invited_by_code)
  );

  const mapMember = (u: (typeof allCustomers)[number], level: 1 | 2 | 3) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    registeredAt: u.created_at,
    tier: getUserPlanTier(u.id),
    level,
    invitedBy: (u.invited_by_code && byCode.get(u.invited_by_code)?.name) || 'Direct',
  });

  return [
    ...level1.map((u) => mapMember(u, 1)),
    ...level2.map((u) => mapMember(u, 2)),
    ...level3.map((u) => mapMember(u, 3)),
  ];
}

function generateUniqueInviteCode(): string {
  const db = getDb();
  for (let i = 0; i < 30; i += 1) {
    const candidate = String(100000 + crypto.randomInt(0, 899999));
    const exists = db
      .prepare('SELECT 1 FROM users WHERE invitation_code = ?')
      .get(candidate);
    if (!exists) return candidate;
  }
  return String(Date.now()).slice(-6);
}

function isAdminConfigured(): boolean {
  if (getEnvAdminPassword().length > 0) return true;
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM app_secrets WHERE key = ?')
    .get('admin_password_hash') as { value?: string } | undefined;
  return Boolean(row?.value);
}

export function createApiRouter(): express.Router {
  registerSessionSecretProvider(() => {
    const db = getDb();
    const existing = db
      .prepare('SELECT value FROM app_secrets WHERE key = ?')
      .get('session_signing_secret') as { value?: string } | undefined;
    if (existing?.value && existing.value.length >= 32) {
      return existing.value;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT OR IGNORE INTO app_secrets (key, value) VALUES (?, ?)').run(
      'session_signing_secret',
      generated
    );
    const stored = db
      .prepare('SELECT value FROM app_secrets WHERE key = ?')
      .get('session_signing_secret') as { value?: string } | undefined;
    return stored?.value || generated;
  });

  const router = express.Router();

  // Restore existing persistent session cookie until explicit logout
  router.get('/auth/session', (req, res) => {
    const cookieToken = parseCookieValue(req, SESSION_COOKIE_NAME);
    if (!cookieToken) {
      res.json({ authenticated: false });
      return;
    }
    const payload = verifyToken(cookieToken);
    if (!payload) {
      clearSessionCookie(req, res);
      res.json({ authenticated: false });
      return;
    }

    if (payload.role === 'admin') {
      const adminUsername = getAdminUsername();
      const refreshedToken = issueToken({
        userId: 'admin-1',
        role: 'admin',
        name: adminUsername,
      });
      setSessionCookie(req, res, refreshedToken);
      res.json({
        authenticated: true,
        token: refreshedToken,
        user: {
          id: 'admin-1',
          name: adminUsername,
          phone: adminUsername,
          role: 'admin',
        },
      });
      return;
    }

    const db = getDb();
    const userRow = db
      .prepare(
        'SELECT id, name, phone, status, terms_accepted FROM users WHERE id = ?'
      )
      .get(payload.userId) as
      | {
          id: string;
          name: string;
          phone: string;
          status: string;
          terms_accepted: number;
        }
      | undefined;

    if (!userRow || userRow.status === 'Suspended') {
      clearSessionCookie(req, res);
      res.json({ authenticated: false });
      return;
    }

    const refreshedToken = issueToken({
      userId: userRow.id,
      role: 'customer',
      name: userRow.name,
    });
    setSessionCookie(req, res, refreshedToken);
    res.json({
      authenticated: true,
      token: refreshedToken,
      user: {
        id: userRow.id,
        name: userRow.name,
        phone: userRow.phone,
        role: 'customer',
        termsAccepted: Boolean(userRow.terms_accepted),
      },
    });
  });

  router.post('/auth/logout', (req, res) => {
    if (!verifyCsrfForCookieMutation(req)) {
      res.status(403).json({ error: 'Invalid logout request origin.' });
      return;
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Admin bootstrap status (allows one-time initial password claim in preview if env secret is unset)
  router.get('/auth/admin-bootstrap-status', (_req, res) => {
    res.json({
      configured: isAdminConfigured(),
      adminUsername: getAdminUsername(),
    });
  });

  router.post('/auth/admin-bootstrap', (req, res) => {
    if (isAdminConfigured()) {
      res.status(409).json({ error: 'Admin password is already configured.' });
      return;
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirmPassword =
      typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
    if (password.length < 8) {
      res.status(400).json({ error: 'Admin password must be at least 8 characters.' });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }

    const db = getDb();
    const hash = hashPassword(password);
    const result = db
      .prepare('INSERT OR IGNORE INTO app_secrets (key, value) VALUES (?, ?)')
      .run('admin_password_hash', hash);

    if (result.changes === 0) {
      res.status(409).json({ error: 'Admin password was already claimed.' });
      return;
    }

    insertAuditLog(
      getAdminUsername(),
      'Initialized Admin Access',
      getAdminUsername(),
      'One-time admin password configured'
    );
    res.status(201).json({ ok: true });
  });

  // Shared Login Endpoint (Customers + Admin)
  router.post('/auth/login', (req, res) => {
    const identifier =
      typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!identifier || !password) {
      res.status(400).json({ error: 'Enter your phone number or name and password.' });
      return;
    }

    const adminUsername = getAdminUsername();
    if (identifier.toLowerCase() === adminUsername.toLowerCase()) {
      const envPass = getEnvAdminPassword();
      let validAdmin = false;
      if (envPass.length > 0) {
        validAdmin = verifyPlaintextConstantTime(password, envPass);
      } else {
        const db = getDb();
        const secretRow = db
          .prepare('SELECT value FROM app_secrets WHERE key = ?')
          .get('admin_password_hash') as { value?: string } | undefined;
        if (!secretRow?.value) {
          res.status(403).json({
            error: 'Admin password is not configured yet. Complete initial setup first.',
          });
          return;
        }
        validAdmin = verifyPassword(password, secretRow.value);
      }

      if (!validAdmin) {
        res.status(401).json({ error: 'Invalid credentials.' });
        return;
      }

      const token = issueToken({
        userId: 'admin-1',
        role: 'admin',
        name: adminUsername,
      });

      setSessionCookie(req, res, token);
      res.json({
        token,
        user: {
          id: 'admin-1',
          name: adminUsername,
          phone: adminUsername,
          role: 'admin',
        },
      });
      return;
    }

    // Customer login
    const db = getDb();
    const normPhone = normalizePhone(identifier);
    const userRow = db
      .prepare(
        `SELECT id, name, phone, password_hash, role, status, terms_accepted
         FROM users
         WHERE phone_normalized = ? OR LOWER(name) = ?`
      )
      .get(normPhone, identifier.toLowerCase()) as
      | {
          id: string;
          name: string;
          phone: string;
          password_hash: string;
          role: 'customer';
          status: string;
          terms_accepted: number;
        }
      | undefined;

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    if (userRow.status === 'Suspended') {
      res.status(403).json({ error: 'Account suspended. Contact Support.' });
      return;
    }

    const token = issueToken({
      userId: userRow.id,
      role: 'customer',
      name: userRow.name,
    });

    setSessionCookie(req, res, token);
    res.json({
      token,
      user: {
        id: userRow.id,
        name: userRow.name,
        phone: userRow.phone,
        role: 'customer',
        termsAccepted: Boolean(userRow.terms_accepted),
      },
    });
  });

  // Customer Registration Only (no Admin registration)
  router.post('/auth/register', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirmPassword =
      typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
    const invitationCode =
      typeof req.body?.invitationCode === 'string'
        ? req.body.invitationCode.trim()
        : '';

    if (name.length < 2) {
      res.status(400).json({ error: 'Name must be at least 2 characters.' });
      return;
    }
    if (name.toLowerCase() === getAdminUsername().toLowerCase()) {
      res.status(400).json({ error: 'This name is reserved.' });
      return;
    }
    if (phone.replace(/\D/g, '').length < 9) {
      res.status(400).json({ error: 'Enter a valid phone number.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }
    if (invitationCode.length > 0 && !/^\d{4,10}$/.test(invitationCode)) {
      res.status(400).json({ error: 'Invitation code must be numeric.' });
      return;
    }

    const db = getDb();
    const normPhone = normalizePhone(phone);
    const existing = db
      .prepare(
        'SELECT id FROM users WHERE phone_normalized = ? OR LOWER(TRIM(name)) = ?'
      )
      .get(normPhone, name.toLowerCase());

    if (existing) {
      res.status(409).json({ error: 'Account already exists. Please login instead.' });
      return;
    }

    const settings = getPaymentSettings(db);
    const userId = `cust-${crypto.randomUUID().slice(0, 8)}`;
    const newInviteCode = generateUniqueInviteCode();
    const passwordHash = hashPassword(password);
    const regBonus = settings.registrationBonusEtb;

    db.prepare(
      `INSERT INTO users (
        id, name, phone, phone_normalized, password_hash, role, status,
        invitation_code, invited_by_code, wallet_balance_etb,
        total_deposit_etb, total_withdraw_etb, total_commission_etb,
        last_check_in_at, terms_accepted, created_at
      ) VALUES (?, ?, ?, ?, ?, 'customer', 'Active', ?, ?, ?, 0, 0, 0, NULL, 0, ?)`
    ).run(
      userId,
      name,
      phone,
      normPhone,
      passwordHash,
      newInviteCode,
      invitationCode || null,
      regBonus,
      new Date().toISOString().slice(0, 10)
    );

    db.prepare(
      'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      `act-${crypto.randomUUID().slice(0, 8)}`,
      userId,
      `Registered (${regBonus} ETB Bonus)`,
      'Member',
      'Completed',
      nowTimestamp()
    );

    insertNotification(
      userId,
      'Welcome to ZENTRO',
      `Welcome ${name}! Your account has been created with a ${regBonus} ETB registration bonus.`,
      'info'
    );

    const token = issueToken({
      userId,
      role: 'customer',
      name,
    });

    setSessionCookie(req, res, token);
    res.status(201).json({
      token,
      user: {
        id: userId,
        name,
        phone,
        role: 'customer',
        termsAccepted: false,
      },
    });
  });

  // Public/Customer Payment Settings & VIP Plans
  router.get('/payment-settings', (_req, res) => {
    const db = getDb();
    const settings = getPaymentSettings(db);
    res.json({
      ...settings,
      vipPlans: SERVER_VIP_PLANS,
      welfarePlans: SERVER_WELFARE_PLANS,
    });
  });

  // Customer Full Profile & Dashboard Data
  router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
    if (req.auth?.role !== 'customer') {
      res.status(403).json({ error: 'Customer account required.' });
      return;
    }
    const db = getDb();
    const userId = req.auth.userId;
    releaseMaturedWelfarePlansForUser(userId);

    const user = db
      .prepare(
        `SELECT id, name, phone, role, status, invitation_code, invited_by_code,
                wallet_balance_etb, total_deposit_etb, total_withdraw_etb,
                total_commission_etb, last_check_in_at, terms_accepted,
                bank_account_name, bank_account_number, bank_method, created_at
         FROM users WHERE id = ?`
      )
      .get(userId) as Record<string, unknown> | undefined;

    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const purchasedPlans = db
      .prepare(
        `SELECT id, plan_id as planId, tier, investment_etb as investmentEtb,
                daily_income_etb as dailyIncomeEtb, cycle_days as cycleDays,
                purchased_at as purchaseDate, next_cycle_at as nextCycleAt, status
         FROM purchased_plans WHERE user_id = ? ORDER BY rowid DESC`
      )
      .all(userId);

    const welfareEnrollments = db
      .prepare(
        `SELECT id, plan_id as planId, plan_name as planName,
                investment_etb as investmentEtb, daily_amount_etb as dailyAmountEtb,
                duration_days as durationDays, claimed_days as claimedDays,
                accumulated_etb as accumulatedEtb, started_at as startedAt,
                started_at_ms as startedAtMs, matures_at_ms as maturesAtMs,
                last_claim_at_ms as lastClaimAtMs, status, released_at as releasedAt
         FROM welfare_enrollments WHERE user_id = ? ORDER BY rowid DESC`
      )
      .all(userId);

    const checkInHistory = db
      .prepare(
        `SELECT id, reward_etb as rewardEtb, claimed_at as timestamp
         FROM check_in_history WHERE user_id = ? ORDER BY rowid DESC LIMIT 20`
      )
      .all(userId);

    const deposits = db
      .prepare(
        `SELECT id, amount_etb as amountEtb, reference_code as referenceCode,
                payment_method_name as paymentMethodName, account_name as accountName,
                account_number as accountNumber, receipt_filename as receiptFilename,
                status, rejection_reason as rejectionReason, created_at as createdAt
         FROM deposit_requests WHERE user_id = ? ORDER BY rowid DESC`
      )
      .all(userId);

    const withdrawals = db
      .prepare(
        `SELECT id, amount_etb as amountEtb, fee_etb as feeEtb, net_amount_etb as netAmountEtb,
                payment_method_name as paymentMethodName,
                customer_account_name as customerAccountName,
                customer_account_number as customerAccountNumber,
                status, rejection_reason as rejectionReason, created_at as createdAt,
                processed_at as processedAt
         FROM withdrawal_requests WHERE user_id = ? ORDER BY rowid DESC`
      )
      .all(userId);

    const notifications = db
      .prepare(
        `SELECT id, title, message, image_filename as imageFilename, type,
                is_read as isRead, created_at as createdAt
         FROM notifications WHERE user_id = ? ORDER BY rowid DESC LIMIT 50`
      )
      .all(userId) as Record<string, unknown>[];

    const feedbackMessages = db
      .prepare(
        `SELECT id, category, subject, message, status, admin_reply as adminReply,
                replied_at as repliedAt, created_at as createdAt
         FROM feedback_messages WHERE user_id = ? ORDER BY rowid DESC`
      )
      .all(userId);

    const activities = db
      .prepare(
        `SELECT id, action, plan_tier as planTier, status, created_at as timestamp
         FROM activities WHERE user_id = ? ORDER BY rowid DESC LIMIT 30`
      )
      .all(userId);

    const teamMembers = computeCustomerTeam(String(user.invitation_code));
    const paymentSettings = getPaymentSettings(db);
    const activeBroadcast = db
      .prepare(
        `SELECT id, title, message, image_filename as imageFilename, created_by as createdBy, created_at as createdAt
         FROM broadcast_messages
         WHERE target_user_id IS NULL
         ORDER BY rowid DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;

    res.json({
      user: {
        id: String(user.id),
        name: String(user.name),
        phone: String(user.phone),
        role: 'customer',
        status: String(user.status),
        invitationCode: String(user.invitation_code),
        invitedByCode: user.invited_by_code ? String(user.invited_by_code) : undefined,
        walletBalanceEtb: Number(user.wallet_balance_etb),
        totalDepositEtb: Number(user.total_deposit_etb),
        totalWithdrawEtb: Number(user.total_withdraw_etb),
        totalCommissionEtb: Number(user.total_commission_etb),
        lastCheckInAt:
          user.last_check_in_at !== null && user.last_check_in_at !== undefined
            ? Number(user.last_check_in_at)
            : null,
        termsAccepted: Boolean(user.terms_accepted),
        registeredAt: String(user.created_at),
        bankAccount: user.bank_account_number
          ? {
              accountName: String(user.bank_account_name ?? ''),
              accountNumber: String(user.bank_account_number),
              method: String(user.bank_method ?? 'CBE'),
            }
          : undefined,
      },
      purchasedPlans,
      welfareEnrollments,
      checkInHistory,
      deposits,
      withdrawals,
      notifications: notifications.map((n) => ({
        ...n,
        isRead: Boolean(n.isRead),
      })),
      activeBroadcast: activeBroadcast ?? null,
      feedbackMessages,
      activities,
      teamMembers,
      paymentSettings,
      vipPlans: SERVER_VIP_PLANS,
      welfarePlans: SERVER_WELFARE_PLANS,
    });
  });

  router.post('/me/accept-terms', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    db.prepare('UPDATE users SET terms_accepted = 1 WHERE id = ?').run(req.auth!.userId);
    res.json({ ok: true });
  });

  // Daily Check-in (24-hour enforced on server)
  router.post('/me/check-in', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const userId = req.auth!.userId;
    const settings = getPaymentSettings(db);
    const reward = settings.dailyCheckInEtb;
    const nowMs = Date.now();
    const dayMs = 24 * 3600 * 1000;

    try {
      db.exec('BEGIN IMMEDIATE');
      const user = db
        .prepare('SELECT last_check_in_at, wallet_balance_etb FROM users WHERE id = ?')
        .get(userId) as
        | { last_check_in_at: number | null; wallet_balance_etb: number }
        | undefined;

      if (!user) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      if (user.last_check_in_at && nowMs - user.last_check_in_at < dayMs) {
        db.exec('ROLLBACK');
        res.status(429).json({
          error: 'Daily check-in already claimed. Please wait for the 24-hour timer.',
        });
        return;
      }

      const nextBalance = user.wallet_balance_etb + reward;
      db.prepare(
        'UPDATE users SET last_check_in_at = ?, wallet_balance_etb = ? WHERE id = ?'
      ).run(nowMs, nextBalance, userId);

      const stamp = nowTimestamp();
      db.prepare(
        'INSERT INTO check_in_history (id, user_id, reward_etb, claimed_at) VALUES (?, ?, ?, ?)'
      ).run(`chk-${crypto.randomUUID().slice(0, 8)}`, userId, reward, stamp);

      db.prepare(
        'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        `act-${crypto.randomUUID().slice(0, 8)}`,
        userId,
        `Daily Check-in (+${reward} ETB)`,
        'Check-in',
        'Completed',
        stamp
      );

      db.exec('COMMIT');
      res.json({
        ok: true,
        rewardEtb: reward,
        lastCheckInAt: nowMs,
        walletBalanceEtb: nextBalance,
      });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Save Customer Bank Account
  router.post('/me/bank-account', requireAuth, (req: AuthenticatedRequest, res) => {
    const accountName =
      typeof req.body?.accountName === 'string' ? req.body.accountName.trim() : '';
    const accountNumber =
      typeof req.body?.accountNumber === 'string'
        ? req.body.accountNumber.replace(/\s+/g, '')
        : '';
    const method =
      typeof req.body?.method === 'string' && req.body.method.trim()
        ? req.body.method.trim()
        : 'CBE';

    if (accountName.length < 2) {
      res.status(400).json({ error: 'Enter account holder name.' });
      return;
    }
    if (!/^\d{8,18}$/.test(accountNumber)) {
      res.status(400).json({ error: 'Account number must be 8–18 digits.' });
      return;
    }

    const db = getDb();
    db.prepare(
      'UPDATE users SET bank_account_name = ?, bank_account_number = ?, bank_method = ? WHERE id = ?'
    ).run(accountName, accountNumber, method, req.auth!.userId);

    res.json({
      ok: true,
      bankAccount: { accountName, accountNumber, method },
    });
  });

  // Mark Notifications Read
  router.post('/notifications/read', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const notificationId =
      typeof req.body?.notificationId === 'string' ? req.body.notificationId : null;
    if (notificationId) {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
        notificationId,
        req.auth!.userId
      );
    } else {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(
        req.auth!.userId
      );
    }
    res.json({ ok: true });
  });

  // Verify Gift Code
  router.post('/gift-code', requireAuth, (req: AuthenticatedRequest, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const VALID_CODES = ['ZENTRO-VIP-2026', 'BEYOND-LIMITS', 'ZENTRO-2026'];
    if (!code) {
      res.status(400).json({ error: 'Enter a gift code.' });
      return;
    }
    if (!VALID_CODES.includes(code)) {
      res.status(400).json({ error: 'Invalid gift code. Try ZENTRO-VIP-2026.' });
      return;
    }
    const db = getDb();
    db.prepare(
      'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      `act-${crypto.randomUUID().slice(0, 8)}`,
      req.auth!.userId,
      `Gift Code Verified (${code})`,
      'Gift',
      'Completed',
      nowTimestamp()
    );
    res.json({ ok: true, message: `Gift code "${code}" verified.` });
  });

  // Buy VIP Plan (Deducts from verified wallet balance & logs referral commission)
  router.post('/plans/buy', requireAuth, (req: AuthenticatedRequest, res) => {
    const planId = typeof req.body?.planId === 'string' ? req.body.planId : '';
    const plan = SERVER_VIP_PLANS.find((p) => p.id === planId);
    if (!plan) {
      res.status(400).json({ error: 'Invalid VIP package selected.' });
      return;
    }

    const db = getDb();
    const userId = req.auth!.userId;
    const settings = getPaymentSettings(db);

    try {
      db.exec('BEGIN IMMEDIATE');
      const user = db
        .prepare('SELECT id, name, wallet_balance_etb, invited_by_code FROM users WHERE id = ?')
        .get(userId) as
        | {
            id: string;
            name: string;
            wallet_balance_etb: number;
            invited_by_code: string | null;
          }
        | undefined;

      if (!user) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      if (user.wallet_balance_etb < plan.investmentEtb) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: `Insufficient wallet balance (${user.wallet_balance_etb.toLocaleString()} ETB). Deposit ${plan.investmentEtb.toLocaleString()} ETB first.`,
        });
        return;
      }

      const nextBalance = user.wallet_balance_etb - plan.investmentEtb;
      db.prepare('UPDATE users SET wallet_balance_etb = ? WHERE id = ?').run(
        nextBalance,
        userId
      );

      const purchaseDate = new Date().toISOString().slice(0, 10);
      const nextCycleAt = Date.now() + 24 * 3600 * 1000;
      db.prepare(
        `INSERT INTO purchased_plans (
          id, user_id, plan_id, tier, investment_etb, daily_income_etb,
          cycle_days, purchased_at, next_cycle_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`
      ).run(
        `pur-${crypto.randomUUID().slice(0, 8)}`,
        userId,
        plan.id,
        plan.tier,
        plan.investmentEtb,
        plan.dailyIncomeEtb,
        plan.cycleDays,
        purchaseDate,
        nextCycleAt
      );

      db.prepare(
        'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        `act-${crypto.randomUUID().slice(0, 8)}`,
        userId,
        `Purchased ${plan.tier} (${plan.investmentEtb.toLocaleString()} ETB)`,
        plan.tier,
        'Completed',
        nowTimestamp()
      );

      // Referral Commission chain (L1 15%, L2 2%, L3 1%)
      const pcts = [
        settings.level1CommissionPercent,
        settings.level2CommissionPercent,
        settings.level3CommissionPercent,
      ];
      let currentInviteCode = user.invited_by_code;
      for (let level = 0; level < 3 && currentInviteCode; level += 1) {
        const upline = db
          .prepare('SELECT id, invited_by_code FROM users WHERE invitation_code = ?')
          .get(currentInviteCode) as
          | { id: string; invited_by_code: string | null }
          | undefined;
        if (!upline) break;
        const comm = Math.round((plan.investmentEtb * pcts[level]) / 100);
        if (comm > 0) {
          db.prepare(
            'UPDATE users SET wallet_balance_etb = wallet_balance_etb + ?, total_commission_etb = total_commission_etb + ? WHERE id = ?'
          ).run(comm, comm, upline.id);
          insertNotification(
            upline.id,
            `Level ${level + 1} Referral Commission`,
            `You received ${comm.toLocaleString()} ETB commission from ${user.name}'s ${plan.tier} plan purchase.`,
            'commission'
          );
        }
        currentInviteCode = upline.invited_by_code;
      }

      db.exec('COMMIT');
      res.status(201).json({ ok: true, walletBalanceEtb: nextBalance });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Start Welfare Plan (Locks investment for durationDays; daily claims accumulate separately until maturity)
  router.post('/welfare/buy', requireAuth, (req: AuthenticatedRequest, res) => {
    const planId = typeof req.body?.planId === 'string' ? req.body.planId : '';
    const plan = SERVER_WELFARE_PLANS.find((p) => p.id === planId);
    if (!plan) {
      res.status(400).json({ error: 'Invalid Welfare Plan selected.' });
      return;
    }

    const db = getDb();
    const userId = req.auth!.userId;

    try {
      db.exec('BEGIN IMMEDIATE');
      const user = db
        .prepare('SELECT id, wallet_balance_etb FROM users WHERE id = ?')
        .get(userId) as { id: string; wallet_balance_etb: number } | undefined;

      if (!user) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      if (user.wallet_balance_etb < plan.investmentEtb) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: `Insufficient wallet balance (${user.wallet_balance_etb.toLocaleString()} ETB). Deposit ${plan.investmentEtb.toLocaleString()} ETB first.`,
        });
        return;
      }

      const nextBalance = user.wallet_balance_etb - plan.investmentEtb;
      db.prepare('UPDATE users SET wallet_balance_etb = ? WHERE id = ?').run(
        nextBalance,
        userId
      );

      const nowMs = Date.now();
      const maturesAtMs = nowMs + plan.durationDays * 24 * 3600 * 1000;
      const startedAt = new Date(nowMs).toISOString().slice(0, 10);
      const id = `wel-${crypto.randomUUID().slice(0, 8)}`;

      db.prepare(
        `INSERT INTO welfare_enrollments (
          id, user_id, plan_id, plan_name, investment_etb, daily_amount_etb,
          duration_days, claimed_days, accumulated_etb, started_at,
          started_at_ms, matures_at_ms, last_claim_at_ms, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, NULL, 'Active')`
      ).run(
        id,
        userId,
        plan.id,
        plan.name,
        plan.investmentEtb,
        plan.dailyAmountEtb,
        plan.durationDays,
        startedAt,
        nowMs,
        maturesAtMs
      );

      db.prepare(
        'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        `act-${crypto.randomUUID().slice(0, 8)}`,
        userId,
        `Started Welfare ${plan.name} (${plan.investmentEtb.toLocaleString()} ETB · ${plan.durationDays}d Lock)`,
        plan.name,
        'Active',
        nowTimestamp()
      );

      db.exec('COMMIT');
      res.status(201).json({ ok: true, id, walletBalanceEtb: nextBalance });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Claim Daily Welfare Profit (Accumulates in separate Welfare Vault; auto-releases to wallet if mature & complete)
  router.post('/welfare/claim', requireAuth, (req: AuthenticatedRequest, res) => {
    const enrollmentId =
      typeof req.body?.enrollmentId === 'string' ? req.body.enrollmentId.trim() : '';
    if (!enrollmentId) {
      res.status(400).json({ error: 'Welfare plan record ID required.' });
      return;
    }

    const db = getDb();
    const userId = req.auth!.userId;
    const nowMs = Date.now();
    const dayMs = 24 * 3600 * 1000;

    try {
      db.exec('BEGIN IMMEDIATE');
      const row = db
        .prepare(
          `SELECT id, plan_name, daily_amount_etb, duration_days, claimed_days,
                  accumulated_etb, matures_at_ms, last_claim_at_ms, status
           FROM welfare_enrollments WHERE id = ? AND user_id = ?`
        )
        .get(enrollmentId, userId) as
        | {
            id: string;
            plan_name: string;
            daily_amount_etb: number;
            duration_days: number;
            claimed_days: number;
            accumulated_etb: number;
            matures_at_ms: number;
            last_claim_at_ms: number | null;
            status: string;
          }
        | undefined;

      if (!row) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Welfare plan not found.' });
        return;
      }
      if (row.status !== 'Active') {
        db.exec('ROLLBACK');
        res.status(400).json({ error: 'This Welfare Plan has already been completed.' });
        return;
      }
      if (row.claimed_days >= row.duration_days) {
        db.exec('ROLLBACK');
        res.status(400).json({ error: 'All daily claims for this plan are completed.' });
        return;
      }
      if (row.last_claim_at_ms && nowMs - row.last_claim_at_ms < dayMs) {
        db.exec('ROLLBACK');
        res.status(429).json({
          error: 'Daily Welfare claim already collected. Wait for the 24-hour timer.',
        });
        return;
      }

      const nextClaimedDays = row.claimed_days + 1;
      const nextAccumulated = row.accumulated_etb + row.daily_amount_etb;
      const shouldAutoRelease =
        nextClaimedDays >= row.duration_days && nowMs >= row.matures_at_ms;
      const stamp = nowTimestamp();

      if (shouldAutoRelease) {
        db.prepare(
          `UPDATE welfare_enrollments
           SET claimed_days = ?, accumulated_etb = ?, last_claim_at_ms = ?, status = 'Completed', released_at = ?
           WHERE id = ? AND user_id = ?`
        ).run(nextClaimedDays, nextAccumulated, nowMs, stamp, row.id, userId);

        db.prepare(
          'UPDATE users SET wallet_balance_etb = wallet_balance_etb + ? WHERE id = ?'
        ).run(nextAccumulated, userId);

        db.prepare(
          'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          `act-${crypto.randomUUID().slice(0, 8)}`,
          userId,
          `Welfare ${row.plan_name} Matured (+${nextAccumulated.toLocaleString()} ETB to Wallet)`,
          row.plan_name,
          'Completed',
          stamp
        );

        insertNotification(
          userId,
          `Welfare ${row.plan_name} Released to Wallet`,
          `Your ${row.duration_days}-day Welfare Plan is complete. ${nextAccumulated.toLocaleString()} ETB moved into your Wallet for withdrawal.`,
          'welfare'
        );
      } else {
        db.prepare(
          `UPDATE welfare_enrollments
           SET claimed_days = ?, accumulated_etb = ?, last_claim_at_ms = ?
           WHERE id = ? AND user_id = ?`
        ).run(nextClaimedDays, nextAccumulated, nowMs, row.id, userId);

        db.prepare(
          'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          `act-${crypto.randomUUID().slice(0, 8)}`,
          userId,
          `Welfare Daily Claim (+${row.daily_amount_etb.toLocaleString()} ETB Saved · Day ${nextClaimedDays}/${row.duration_days})`,
          row.plan_name,
          'Saved',
          stamp
        );
      }

      db.exec('COMMIT');
      res.json({
        ok: true,
        claimedDays: nextClaimedDays,
        accumulatedEtb: nextAccumulated,
        releasedToWallet: shouldAutoRelease,
      });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Release Matured Welfare Vault to Main Wallet (Strictly blocked before matures_at_ms)
  router.post('/welfare/release', requireAuth, (req: AuthenticatedRequest, res) => {
    const enrollmentId =
      typeof req.body?.enrollmentId === 'string' ? req.body.enrollmentId.trim() : '';
    if (!enrollmentId) {
      res.status(400).json({ error: 'Welfare plan record ID required.' });
      return;
    }

    const db = getDb();
    const userId = req.auth!.userId;
    const nowMs = Date.now();

    try {
      db.exec('BEGIN IMMEDIATE');
      const row = db
        .prepare(
          `SELECT id, plan_name, duration_days, accumulated_etb, matures_at_ms, status
           FROM welfare_enrollments WHERE id = ? AND user_id = ?`
        )
        .get(enrollmentId, userId) as
        | {
            id: string;
            plan_name: string;
            duration_days: number;
            accumulated_etb: number;
            matures_at_ms: number;
            status: string;
          }
        | undefined;

      if (!row) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Welfare plan not found.' });
        return;
      }
      if (row.status !== 'Active') {
        db.exec('ROLLBACK');
        res.status(400).json({ error: 'Accumulated funds were already released to wallet.' });
        return;
      }
      if (nowMs < row.matures_at_ms) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: `Locked until Day ${row.duration_days} completes. Early withdrawal is not allowed.`,
        });
        return;
      }
      if (row.accumulated_etb <= 0) {
        db.exec('ROLLBACK');
        res.status(400).json({ error: 'Claim at least one daily profit before releasing.' });
        return;
      }

      const stamp = nowTimestamp();
      db.prepare(
        "UPDATE welfare_enrollments SET status = 'Completed', released_at = ? WHERE id = ? AND user_id = ?"
      ).run(stamp, row.id, userId);

      db.prepare(
        'UPDATE users SET wallet_balance_etb = wallet_balance_etb + ? WHERE id = ?'
      ).run(row.accumulated_etb, userId);

      db.prepare(
        'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        `act-${crypto.randomUUID().slice(0, 8)}`,
        userId,
        `Welfare ${row.plan_name} Matured (+${row.accumulated_etb.toLocaleString()} ETB to Wallet)`,
        row.plan_name,
        'Completed',
        stamp
      );

      insertNotification(
        userId,
        `Welfare ${row.plan_name} Released to Wallet`,
        `Your ${row.duration_days}-day Welfare Plan matured. ${row.accumulated_etb.toLocaleString()} ETB moved into your Wallet for withdrawal.`,
        'welfare'
      );

      db.exec('COMMIT');
      res.json({ ok: true, releasedEtb: row.accumulated_etb });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Submit Deposit Request with Receipt Image
  router.post('/deposits', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const settings = getPaymentSettings(db);

    const amountEtb = Number(req.body?.amountEtb);
    const referenceCode =
      typeof req.body?.referenceCode === 'string' ? req.body.referenceCode.trim() : '';
    const paymentMethodId =
      typeof req.body?.paymentMethodId === 'string' ? req.body.paymentMethodId : '';
    const receiptDataUrl =
      typeof req.body?.receiptDataUrl === 'string' ? req.body.receiptDataUrl : '';

    if (!Number.isFinite(amountEtb) || amountEtb < settings.minRechargeEtb) {
      res.status(400).json({
        error: `Minimum deposit is ${settings.minRechargeEtb.toLocaleString()} ETB.`,
      });
      return;
    }
    if (referenceCode.length < 3) {
      res.status(400).json({ error: 'Enter transaction reference / short code.' });
      return;
    }

    const method = settings.depositMethods.find(
      (m) => m.id === paymentMethodId && m.enabled
    );
    if (!method) {
      res.status(400).json({ error: 'Selected deposit method is currently unavailable.' });
      return;
    }
    if (!receiptDataUrl) {
      res.status(400).json({ error: 'Please upload your payment receipt image.' });
      return;
    }

    let receiptFilename: string;
    try {
      receiptFilename = saveValidatedBase64Image(receiptDataUrl, 'receipt');
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const id = `dep-${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = nowTimestamp();
    db.prepare(
      `INSERT INTO deposit_requests (
        id, user_id, amount_etb, reference_code, payment_method_id,
        payment_method_name, account_name, account_number, receipt_filename,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`
    ).run(
      id,
      req.auth!.userId,
      amountEtb,
      referenceCode,
      method.id,
      method.methodName,
      method.accountName,
      method.accountNumber,
      receiptFilename,
      createdAt
    );

    db.prepare(
      'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      `act-${crypto.randomUUID().slice(0, 8)}`,
      req.auth!.userId,
      `Deposit Request (${amountEtb.toLocaleString()} ETB)`,
      method.methodName,
      'Pending',
      createdAt
    );

    res.status(201).json({ ok: true, id });
  });

  // Submit Withdrawal Request (Server enforces balance, 1-plan requirement, schedule, min withdrawal)
  router.post('/withdrawals', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const settings = getPaymentSettings(db);

    const amountEtb = Number(req.body?.amountEtb);
    const paymentMethodId =
      typeof req.body?.paymentMethodId === 'string' ? req.body.paymentMethodId : '';

    const method = settings.withdrawalMethods.find(
      (m) => m.id === paymentMethodId && m.enabled
    );
    if (!method) {
      res.status(400).json({ error: 'Selected withdrawal method is unavailable.' });
      return;
    }
    if (!Number.isFinite(amountEtb) || amountEtb < settings.minWithdrawalEtb) {
      res.status(400).json({
        error: `Minimum withdrawal is ${settings.minWithdrawalEtb.toLocaleString()} ETB.`,
      });
      return;
    }

    if (settings.enforceWithdrawalHours) {
      const hour = new Date().getHours();
      const start = settings.withdrawalStartHour;
      const end = settings.withdrawalEndHour;
      const allowed = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
      if (!allowed) {
        res.status(400).json({
          error: `Withdrawals are accepted between ${String(start).padStart(
            2,
            '0'
          )}:00 and ${String(end).padStart(2, '0')}:00.`,
        });
        return;
      }
    }

    const userId = req.auth!.userId;
    try {
      db.exec('BEGIN IMMEDIATE');
      const user = db
        .prepare(
          'SELECT wallet_balance_etb, bank_account_name, bank_account_number FROM users WHERE id = ?'
        )
        .get(userId) as
        | {
            wallet_balance_etb: number;
            bank_account_name: string | null;
            bank_account_number: string | null;
          }
        | undefined;

      if (!user) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      const vipCountRow = db
        .prepare('SELECT COUNT(*) as cnt FROM purchased_plans WHERE user_id = ?')
        .get(userId) as { cnt: number };
      const welfareCountRow = db
        .prepare('SELECT COUNT(*) as cnt FROM welfare_enrollments WHERE user_id = ?')
        .get(userId) as { cnt: number };
      if (vipCountRow.cnt + welfareCountRow.cnt < 1) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: 'You must purchase at least 1 plan before making your first withdrawal.',
        });
        return;
      }

      if (!user.bank_account_number || !user.bank_account_name) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: 'Save your Bank Account details in Me before requesting withdrawal.',
        });
        return;
      }

      if (user.wallet_balance_etb < amountEtb) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: `Insufficient wallet balance (${user.wallet_balance_etb.toLocaleString()} ETB available).`,
        });
        return;
      }

      const feeEtb = Math.round((amountEtb * settings.withdrawalFeePercent) / 100);
      const netAmountEtb = Math.max(0, amountEtb - feeEtb);
      const nextBalance = user.wallet_balance_etb - amountEtb;

      db.prepare('UPDATE users SET wallet_balance_etb = ? WHERE id = ?').run(
        nextBalance,
        userId
      );

      const id = `wd-${crypto.randomUUID().slice(0, 8)}`;
      const createdAt = nowTimestamp();
      db.prepare(
        `INSERT INTO withdrawal_requests (
          id, user_id, amount_etb, fee_etb, net_amount_etb,
          payment_method_id, payment_method_name,
          customer_account_name, customer_account_number,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`
      ).run(
        id,
        userId,
        amountEtb,
        feeEtb,
        netAmountEtb,
        method.id,
        method.methodName,
        user.bank_account_name,
        user.bank_account_number,
        createdAt
      );

      db.prepare(
        'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        `act-${crypto.randomUUID().slice(0, 8)}`,
        userId,
        `Withdrawal Request (${amountEtb.toLocaleString()} ETB)`,
        method.methodName,
        'Pending',
        createdAt
      );

      db.exec('COMMIT');
      res.status(201).json({ ok: true, id, walletBalanceEtb: nextBalance });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Submit Customer Feedback / Complaint
  router.post('/support', requireAuth, (req: AuthenticatedRequest, res) => {
    const category =
      typeof req.body?.category === 'string' ? req.body.category.trim() : 'General Inquiry';
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (subject.length < 3 || message.length < 5) {
      res.status(400).json({ error: 'Enter a subject and message.' });
      return;
    }

    const db = getDb();
    const id = `fb-${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = nowTimestamp();
    db.prepare(
      `INSERT INTO feedback_messages (id, user_id, category, subject, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'Unread', ?)`
    ).run(id, req.auth!.userId, category, subject, message, createdAt);

    db.prepare(
      'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      `act-${crypto.randomUUID().slice(0, 8)}`,
      req.auth!.userId,
      `Support Message (${category})`,
      'Support',
      'Completed',
      createdAt
    );

    res.status(201).json({ ok: true, id });
  });

  // Securely Serve Uploaded Receipts & Broadcast Images
  router.get('/uploads/:filename', (req, res) => {
    const resolved = resolveUploadFile(req.params.filename);
    if (!resolved) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', resolved.contentType);
    res.sendFile(resolved.filePath);
  });

  // =========================================================================
  // ADMIN ROUTES (STRICTLY PROTECTED: NO WALLET BALANCES, NO PASSWORDS)
  // =========================================================================

  router.get('/admin/overview', requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    const totalCustomers = (
      db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('customer') as {
        c: number;
      }
    ).c;
    const activeCustomers = (
      db
        .prepare('SELECT COUNT(*) as c FROM users WHERE role = ? AND status = ?')
        .get('customer', 'Active') as { c: number }
    ).c;
    const pendingDeposits = (
      db
        .prepare("SELECT COUNT(*) as c FROM deposit_requests WHERE status = 'Pending'")
        .get() as { c: number }
    ).c;
    const pendingWithdrawals = (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM withdrawal_requests WHERE status IN ('Pending', 'Approved')"
        )
        .get() as { c: number }
    ).c;
    const unreadFeedback = (
      db
        .prepare("SELECT COUNT(*) as c FROM feedback_messages WHERE status = 'Unread'")
        .get() as { c: number }
    ).c;
    const totalBroadcasts = (
      db.prepare('SELECT COUNT(*) as c FROM broadcast_messages').get() as { c: number }
    ).c;

    const recentAuditLogs = db
      .prepare(
        'SELECT id, actor, action, target, details, created_at as timestamp FROM audit_logs ORDER BY rowid DESC LIMIT 10'
      )
      .all();

    res.json({
      totalCustomers,
      activeCustomers,
      pendingDeposits,
      pendingWithdrawals,
      unreadFeedback,
      totalBroadcasts,
      recentAuditLogs,
    });
  });

  // Admin Customers List (NO wallet_balance_etb, NO password_hash)
  router.get('/admin/customers', requireAuth, requireAdmin, (req, res) => {
    const db = getDb();
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const status =
      typeof req.query.status === 'string' ? req.query.status : 'All';

    const rows = db
      .prepare(
        `SELECT id, name, phone, status, invitation_code as invitationCode,
                invited_by_code as invitedByCode, created_at as registeredAt,
                bank_account_name as bankAccountName, bank_account_number as bankAccountNumber,
                bank_method as bankMethod
         FROM users WHERE role = 'customer' ORDER BY rowid DESC`
      )
      .all() as Record<string, unknown>[];

    const filtered = rows.filter((u) => {
      if (status !== 'All' && u.status !== status) return false;
      if (!q) return true;
      return (
        String(u.phone).toLowerCase().includes(q) ||
        String(u.name).toLowerCase().includes(q) ||
        String(u.invitationCode).toLowerCase().includes(q)
      );
    });

    res.json({ customers: filtered });
  });

  // Admin Customer Full Detail (NO wallet balance, NO password / hash)
  router.get('/admin/customers/:id', requireAuth, requireAdmin, (req, res) => {
    const db = getDb();
    const customerId = req.params.id;
    const customer = db
      .prepare(
        `SELECT id, name, phone, status, invitation_code as invitationCode,
                invited_by_code as invitedByCode, created_at as registeredAt,
                terms_accepted as termsAccepted,
                bank_account_name as bankAccountName, bank_account_number as bankAccountNumber,
                bank_method as bankMethod
         FROM users WHERE id = ? AND role = 'customer'`
      )
      .get(customerId) as Record<string, unknown> | undefined;

    if (!customer) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    const inviter = customer.invitedByCode
      ? (db
          .prepare('SELECT id, name, phone, invitation_code as invitationCode FROM users WHERE invitation_code = ?')
          .get(String(customer.invitedByCode)) as Record<string, unknown> | undefined)
      : undefined;

    const deposits = db
      .prepare(
        `SELECT id, amount_etb as amountEtb, reference_code as referenceCode,
                payment_method_name as paymentMethodName, status, rejection_reason as rejectionReason,
                created_at as createdAt
         FROM deposit_requests WHERE user_id = ? ORDER BY rowid DESC`
      )
      .all(customerId);

    const withdrawals = db
      .prepare(
        `SELECT id, amount_etb as amountEtb, fee_etb as feeEtb, net_amount_etb as netAmountEtb,
                payment_method_name as paymentMethodName, customer_account_number as accountNumber,
                status, rejection_reason as rejectionReason, created_at as createdAt, processed_at as processedAt
         FROM withdrawal_requests WHERE user_id = ? ORDER BY rowid DESC`
      )
      .all(customerId);

    const purchasedPlans = db
      .prepare(
        `SELECT id, tier, investment_etb as investmentEtb, daily_income_etb as dailyIncomeEtb,
                cycle_days as cycleDays, purchased_at as purchaseDate, status
         FROM purchased_plans WHERE user_id = ? ORDER BY rowid DESC`
      )
      .all(customerId);

    const checkInHistory = db
      .prepare(
        'SELECT id, reward_etb as rewardEtb, claimed_at as timestamp FROM check_in_history WHERE user_id = ? ORDER BY rowid DESC'
      )
      .all(customerId);

    const feedback = db
      .prepare(
        `SELECT id, category, subject, message, status, admin_reply as adminReply, created_at as createdAt
         FROM feedback_messages WHERE user_id = ? ORDER BY rowid DESC`
      )
      .all(customerId);

    const activities = db
      .prepare(
        'SELECT id, action, plan_tier as planTier, status, created_at as timestamp FROM activities WHERE user_id = ? ORDER BY rowid DESC'
      )
      .all(customerId);

    const team = computeCustomerTeam(String(customer.invitationCode));

    res.json({
      customer: {
        ...customer,
        termsAccepted: Boolean(customer.termsAccepted),
        inviter: inviter ?? null,
      },
      deposits,
      withdrawals,
      purchasedPlans,
      checkInHistory,
      feedback,
      activities,
      team,
    });
  });

  // Admin Toggle Customer Status (Logs Audit + Notifies Customer)
  router.patch(
    '/admin/customers/:id/status',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const nextStatus = req.body?.status;
      if (nextStatus !== 'Active' && nextStatus !== 'Suspended') {
        res.status(400).json({ error: 'Invalid customer status.' });
        return;
      }

      const db = getDb();
      const customer = db
        .prepare('SELECT id, name, phone FROM users WHERE id = ? AND role = ?')
        .get(req.params.id, 'customer') as
        | { id: string; name: string; phone: string }
        | undefined;

      if (!customer) {
        res.status(404).json({ error: 'Customer not found.' });
        return;
      }

      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(nextStatus, customer.id);
      insertAuditLog(
        req.auth!.name,
        `Updated Customer Status to ${nextStatus}`,
        `${customer.name} (${customer.phone})`
      );
      insertNotification(
        customer.id,
        'Account Status Updated',
        `Your account status has been set to ${nextStatus} by Admin.`,
        'status'
      );

      res.json({ ok: true, status: nextStatus });
    }
  );

  // Admin Deposit Requests
  router.get('/admin/deposits', requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    const deposits = db
      .prepare(
        `SELECT d.id, d.user_id as userId, u.name as customerName, u.phone as customerPhone,
                d.amount_etb as amountEtb, d.reference_code as referenceCode,
                d.payment_method_name as paymentMethodName, d.account_name as accountName,
                d.account_number as accountNumber, d.receipt_filename as receiptFilename,
                d.status, d.rejection_reason as rejectionReason,
                d.reviewed_by as reviewedBy, d.reviewed_at as reviewedAt,
                d.created_at as createdAt
         FROM deposit_requests d
         JOIN users u ON u.id = d.user_id
         ORDER BY d.rowid DESC`
      )
      .all();

    res.json({ deposits });
  });

  router.post(
    '/admin/deposits/:id/approve',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const depositId = req.params.id;

      try {
        db.exec('BEGIN IMMEDIATE');
        const dep = db
          .prepare(
            `SELECT d.id, d.user_id, d.amount_etb, d.reference_code, d.status, u.name, u.phone
             FROM deposit_requests d JOIN users u ON u.id = d.user_id
             WHERE d.id = ?`
          )
          .get(depositId) as
          | {
              id: string;
              user_id: string;
              amount_etb: number;
              reference_code: string;
              status: string;
              name: string;
              phone: string;
            }
          | undefined;

        if (!dep) {
          db.exec('ROLLBACK');
          res.status(404).json({ error: 'Deposit request not found.' });
          return;
        }
        if (dep.status !== 'Pending') {
          db.exec('ROLLBACK');
          res.status(409).json({ error: `Deposit already ${dep.status}. Duplicate credit blocked.` });
          return;
        }

        const stamp = nowTimestamp();
        const updated = db
          .prepare(
            `UPDATE deposit_requests
             SET status = 'Approved', reviewed_by = ?, reviewed_at = ?
             WHERE id = ? AND status = 'Pending'`
          )
          .run(req.auth!.name, stamp, depositId);

        if (updated.changes !== 1) {
          db.exec('ROLLBACK');
          res.status(409).json({ error: 'Deposit already processed.' });
          return;
        }

        db.prepare(
          'UPDATE users SET wallet_balance_etb = wallet_balance_etb + ?, total_deposit_etb = total_deposit_etb + ? WHERE id = ?'
        ).run(dep.amount_etb, dep.amount_etb, dep.user_id);

        db.prepare(
          'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          `act-${crypto.randomUUID().slice(0, 8)}`,
          dep.user_id,
          `Deposit Approved (${dep.amount_etb.toLocaleString()} ETB)`,
          dep.reference_code,
          'Completed',
          stamp
        );

        insertNotification(
          dep.user_id,
          'Deposit Approved',
          `Your deposit of ${dep.amount_etb.toLocaleString()} ETB (Ref: ${dep.reference_code}) has been approved and credited to your wallet.`,
          'deposit'
        );

        insertAuditLog(
          req.auth!.name,
          'Approved Deposit Request',
          `${dep.name} (${dep.phone})`,
          `${dep.amount_etb.toLocaleString()} ETB · Ref ${dep.reference_code}`
        );

        db.exec('COMMIT');
        res.json({ ok: true });
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore
        }
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  router.post(
    '/admin/deposits/:id/reject',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (reason.length < 3) {
        res.status(400).json({ error: 'Enter a rejection reason (min 3 characters).' });
        return;
      }

      const db = getDb();
      const depositId = req.params.id;

      try {
        db.exec('BEGIN IMMEDIATE');
        const dep = db
          .prepare(
            `SELECT d.id, d.user_id, d.amount_etb, d.reference_code, d.status, u.name, u.phone
             FROM deposit_requests d JOIN users u ON u.id = d.user_id
             WHERE d.id = ?`
          )
          .get(depositId) as
          | {
              id: string;
              user_id: string;
              amount_etb: number;
              reference_code: string;
              status: string;
              name: string;
              phone: string;
            }
          | undefined;

        if (!dep) {
          db.exec('ROLLBACK');
          res.status(404).json({ error: 'Deposit request not found.' });
          return;
        }
        if (dep.status !== 'Pending') {
          db.exec('ROLLBACK');
          res.status(409).json({ error: `Deposit already ${dep.status}.` });
          return;
        }

        const stamp = nowTimestamp();
        db.prepare(
          `UPDATE deposit_requests
           SET status = 'Rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?
           WHERE id = ? AND status = 'Pending'`
        ).run(reason, req.auth!.name, stamp, depositId);

        insertNotification(
          dep.user_id,
          'Deposit Rejected',
          `Your deposit of ${dep.amount_etb.toLocaleString()} ETB (Ref: ${dep.reference_code}) was rejected. Reason: ${reason}`,
          'deposit'
        );

        insertAuditLog(
          req.auth!.name,
          'Rejected Deposit Request',
          `${dep.name} (${dep.phone})`,
          `${dep.amount_etb.toLocaleString()} ETB · Reason: ${reason}`
        );

        db.exec('COMMIT');
        res.json({ ok: true });
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore
        }
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  // Admin Withdrawal Requests
  router.get('/admin/withdrawals', requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    const withdrawals = db
      .prepare(
        `SELECT w.id, w.user_id as userId, u.name as customerName, u.phone as customerPhone,
                w.amount_etb as amountEtb, w.fee_etb as feeEtb, w.net_amount_etb as netAmountEtb,
                w.payment_method_name as paymentMethodName,
                w.customer_account_name as customerAccountName,
                w.customer_account_number as customerAccountNumber,
                w.status, w.rejection_reason as rejectionReason,
                w.reviewed_by as reviewedBy, w.processed_at as processedAt,
                w.created_at as createdAt
         FROM withdrawal_requests w
         JOIN users u ON u.id = w.user_id
         ORDER BY w.rowid DESC`
      )
      .all();

    res.json({ withdrawals });
  });

  router.post(
    '/admin/withdrawals/:id/approve',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const wd = db
        .prepare(
          `SELECT w.id, w.user_id, w.amount_etb, w.status, u.name, u.phone
           FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
           WHERE w.id = ?`
        )
        .get(req.params.id) as
        | {
            id: string;
            user_id: string;
            amount_etb: number;
            status: string;
            name: string;
            phone: string;
          }
        | undefined;

      if (!wd) {
        res.status(404).json({ error: 'Withdrawal request not found.' });
        return;
      }
      if (wd.status !== 'Pending') {
        res.status(409).json({ error: `Withdrawal already ${wd.status}.` });
        return;
      }

      db.prepare(
        `UPDATE withdrawal_requests SET status = 'Approved', reviewed_by = ? WHERE id = ? AND status = 'Pending'`
      ).run(req.auth!.name, wd.id);

      insertNotification(
        wd.user_id,
        'Withdrawal Approved',
        `Your withdrawal request of ${wd.amount_etb.toLocaleString()} ETB has been approved and queued for processing.`,
        'withdrawal'
      );

      insertAuditLog(
        req.auth!.name,
        'Approved Withdrawal Request',
        `${wd.name} (${wd.phone})`,
        `${wd.amount_etb.toLocaleString()} ETB`
      );

      res.json({ ok: true });
    }
  );

  router.post(
    '/admin/withdrawals/:id/process',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      try {
        db.exec('BEGIN IMMEDIATE');
        const wd = db
          .prepare(
            `SELECT w.id, w.user_id, w.amount_etb, w.net_amount_etb, w.status, u.name, u.phone
             FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
             WHERE w.id = ?`
          )
          .get(req.params.id) as
          | {
              id: string;
              user_id: string;
              amount_etb: number;
              net_amount_etb: number;
              status: string;
              name: string;
              phone: string;
            }
          | undefined;

        if (!wd) {
          db.exec('ROLLBACK');
          res.status(404).json({ error: 'Withdrawal request not found.' });
          return;
        }
        if (wd.status !== 'Pending' && wd.status !== 'Approved') {
          db.exec('ROLLBACK');
          res.status(409).json({ error: `Withdrawal already ${wd.status}. Duplicate processing prevented.` });
          return;
        }

        const stamp = nowTimestamp();
        const updated = db
          .prepare(
            `UPDATE withdrawal_requests
             SET status = 'Processed', reviewed_by = ?, processed_at = ?
             WHERE id = ? AND status IN ('Pending', 'Approved')`
          )
          .run(req.auth!.name, stamp, wd.id);

        if (updated.changes !== 1) {
          db.exec('ROLLBACK');
          res.status(409).json({ error: 'Withdrawal already processed.' });
          return;
        }

        db.prepare(
          'UPDATE users SET total_withdraw_etb = total_withdraw_etb + ? WHERE id = ?'
        ).run(wd.amount_etb, wd.user_id);

        db.prepare(
          'INSERT INTO activities (id, user_id, action, plan_tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          `act-${crypto.randomUUID().slice(0, 8)}`,
          wd.user_id,
          `Withdrawal Processed (${wd.net_amount_etb.toLocaleString()} ETB Net)`,
          'Withdrawal',
          'Completed',
          stamp
        );

        insertNotification(
          wd.user_id,
          'Withdrawal Completed',
          `Your withdrawal of ${wd.amount_etb.toLocaleString()} ETB (Net ${wd.net_amount_etb.toLocaleString()} ETB) has been processed.`,
          'withdrawal'
        );

        insertAuditLog(
          req.auth!.name,
          'Processed Withdrawal Request',
          `${wd.name} (${wd.phone})`,
          `${wd.amount_etb.toLocaleString()} ETB (Net ${wd.net_amount_etb.toLocaleString()} ETB)`
        );

        db.exec('COMMIT');
        res.json({ ok: true });
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore
        }
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  router.post(
    '/admin/withdrawals/:id/reject',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (reason.length < 3) {
        res.status(400).json({ error: 'Enter a rejection reason (min 3 characters).' });
        return;
      }

      const db = getDb();
      try {
        db.exec('BEGIN IMMEDIATE');
        const wd = db
          .prepare(
            `SELECT w.id, w.user_id, w.amount_etb, w.status, u.name, u.phone
             FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
             WHERE w.id = ?`
          )
          .get(req.params.id) as
          | {
              id: string;
              user_id: string;
              amount_etb: number;
              status: string;
              name: string;
              phone: string;
            }
          | undefined;

        if (!wd) {
          db.exec('ROLLBACK');
          res.status(404).json({ error: 'Withdrawal request not found.' });
          return;
        }
        if (wd.status !== 'Pending' && wd.status !== 'Approved') {
          db.exec('ROLLBACK');
          res.status(409).json({ error: `Withdrawal already ${wd.status}.` });
          return;
        }

        const stamp = nowTimestamp();
        const updated = db
          .prepare(
            `UPDATE withdrawal_requests
             SET status = 'Rejected', rejection_reason = ?, reviewed_by = ?, processed_at = ?
             WHERE id = ? AND status IN ('Pending', 'Approved')`
          )
          .run(reason, req.auth!.name, stamp, wd.id);

        if (updated.changes !== 1) {
          db.exec('ROLLBACK');
          res.status(409).json({ error: 'Withdrawal already updated.' });
          return;
        }

        // Refund reserved withdrawal amount back to wallet
        db.prepare(
          'UPDATE users SET wallet_balance_etb = wallet_balance_etb + ? WHERE id = ?'
        ).run(wd.amount_etb, wd.user_id);

        insertNotification(
          wd.user_id,
          'Withdrawal Rejected',
          `Your withdrawal of ${wd.amount_etb.toLocaleString()} ETB was rejected and refunded to your wallet. Reason: ${reason}`,
          'withdrawal'
        );

        insertAuditLog(
          req.auth!.name,
          'Rejected Withdrawal Request',
          `${wd.name} (${wd.phone})`,
          `${wd.amount_etb.toLocaleString()} ETB · Reason: ${reason}`
        );

        db.exec('COMMIT');
        res.json({ ok: true });
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore
        }
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  // Admin Feedback & Complaints
  router.get('/admin/feedback', requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    const feedback = db
      .prepare(
        `SELECT f.id, f.user_id as userId, u.name as customerName, u.phone as customerPhone,
                f.category, f.subject, f.message, f.status,
                f.admin_reply as adminReply, f.replied_at as repliedAt,
                f.created_at as createdAt
         FROM feedback_messages f
         JOIN users u ON u.id = f.user_id
         ORDER BY f.rowid DESC`
      )
      .all();
    res.json({ feedback });
  });

  router.patch(
    '/admin/feedback/:id/status',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const nextStatus = req.body?.status;
      if (nextStatus !== 'Read' && nextStatus !== 'Resolved') {
        res.status(400).json({ error: 'Invalid feedback status.' });
        return;
      }
      const db = getDb();
      const row = db
        .prepare('SELECT id, subject FROM feedback_messages WHERE id = ?')
        .get(req.params.id) as { id: string; subject: string } | undefined;
      if (!row) {
        res.status(404).json({ error: 'Feedback message not found.' });
        return;
      }

      db.prepare('UPDATE feedback_messages SET status = ? WHERE id = ?').run(
        nextStatus,
        row.id
      );
      insertAuditLog(req.auth!.name, `Marked Feedback ${nextStatus}`, row.subject);
      res.json({ ok: true });
    }
  );

  router.post(
    '/admin/feedback/:id/reply',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const reply = typeof req.body?.reply === 'string' ? req.body.reply.trim() : '';
      if (reply.length < 2) {
        res.status(400).json({ error: 'Enter a reply message.' });
        return;
      }
      const db = getDb();
      const row = db
        .prepare(
          `SELECT f.id, f.user_id, f.subject, u.name, u.phone
           FROM feedback_messages f JOIN users u ON u.id = f.user_id
           WHERE f.id = ?`
        )
        .get(req.params.id) as
        | { id: string; user_id: string; subject: string; name: string; phone: string }
        | undefined;

      if (!row) {
        res.status(404).json({ error: 'Feedback message not found.' });
        return;
      }

      const stamp = nowTimestamp();
      db.prepare(
        `UPDATE feedback_messages
         SET admin_reply = ?, replied_at = ?, status = 'Resolved'
         WHERE id = ?`
      ).run(reply, stamp, row.id);

      insertNotification(
        row.user_id,
        `Support Reply: ${row.subject}`,
        reply,
        'support_reply'
      );

      insertAuditLog(
        req.auth!.name,
        'Replied to Customer Feedback',
        `${row.name} (${row.phone})`,
        row.subject
      );

      res.json({ ok: true });
    }
  );

  // Admin Broadcasts & Direct Messages with Image Upload
  router.get('/admin/broadcasts', requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    const broadcasts = db
      .prepare(
        `SELECT b.id, b.title, b.message, b.image_filename as imageFilename,
                b.target_user_id as targetUserId, u.name as targetCustomerName,
                b.created_by as createdBy, b.created_at as createdAt
         FROM broadcast_messages b
         LEFT JOIN users u ON u.id = b.target_user_id
         ORDER BY b.rowid DESC`
      )
      .all();
    res.json({ broadcasts });
  });

  router.post(
    '/admin/broadcasts',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const imageDataUrl =
        typeof req.body?.imageDataUrl === 'string' ? req.body.imageDataUrl.trim() : '';
      const targetUserId =
        typeof req.body?.targetUserId === 'string' && req.body.targetUserId.trim()
          ? req.body.targetUserId.trim()
          : null;

      if (title.length < 2 || message.length < 3) {
        res.status(400).json({ error: 'Enter both announcement title and message.' });
        return;
      }

      let imageFilename: string | null = null;
      if (imageDataUrl) {
        try {
          imageFilename = saveValidatedBase64Image(imageDataUrl, 'broadcast');
        } catch (err) {
          res.status(400).json({ error: (err as Error).message });
          return;
        }
      }

      const db = getDb();
      const stamp = nowTimestamp();
      const id = `brd-${crypto.randomUUID().slice(0, 8)}`;

      if (targetUserId) {
        const target = db
          .prepare('SELECT id, name, phone FROM users WHERE id = ? AND role = ?')
          .get(targetUserId, 'customer') as
          | { id: string; name: string; phone: string }
          | undefined;
        if (!target) {
          res.status(404).json({ error: 'Selected customer not found.' });
          return;
        }
        db.prepare(
          `INSERT INTO broadcast_messages (id, title, message, image_filename, target_user_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(id, title, message, imageFilename, target.id, req.auth!.name, stamp);

        insertNotification(target.id, title, message, 'broadcast', imageFilename);
        insertAuditLog(
          req.auth!.name,
          'Sent Direct Customer Message',
          `${target.name} (${target.phone})`,
          title
        );
      } else {
        db.prepare(
          `INSERT INTO broadcast_messages (id, title, message, image_filename, target_user_id, created_by, created_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`
        ).run(id, title, message, imageFilename, req.auth!.name, stamp);

        const customers = db
          .prepare("SELECT id FROM users WHERE role = 'customer'")
          .all() as { id: string }[];
        for (const c of customers) {
          insertNotification(c.id, title, message, 'broadcast', imageFilename);
        }
        insertAuditLog(
          req.auth!.name,
          'Broadcast Announcement to All Customers',
          title,
          `Delivered to ${customers.length} customers`
        );
      }

      res.status(201).json({ ok: true, id, imageFilename });
    }
  );

  // Admin Payment Settings Management
  router.get('/admin/payment-settings', requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    res.json(getPaymentSettings(db));
  });

  router.put(
    '/admin/payment-settings',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const body = req.body ?? {};
      const validateMethods = (
        arr: unknown,
        label: string
      ): PaymentMethodConfig[] | null => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const clean: PaymentMethodConfig[] = [];
        for (const item of arr) {
          if (!item || typeof item !== 'object') return null;
          const m = item as Record<string, unknown>;
          const id =
            typeof m.id === 'string' && m.id.trim()
              ? m.id.trim()
              : `${label}-${crypto.randomUUID().slice(0, 6)}`;
          const methodName =
            typeof m.methodName === 'string' ? m.methodName.trim() : '';
          const accountName =
            typeof m.accountName === 'string' ? m.accountName.trim() : '';
          const accountNumber =
            typeof m.accountNumber === 'string' ? m.accountNumber.trim() : '';
          const enabled = Boolean(m.enabled);
          if (!methodName || !accountName || !accountNumber) return null;
          clean.push({ id, methodName, accountName, accountNumber, enabled });
        }
        return clean;
      };

      const depositMethods = validateMethods(body.depositMethods, 'dep');
      const withdrawalMethods = validateMethods(body.withdrawalMethods, 'wd');
      if (!depositMethods || !withdrawalMethods) {
        res.status(400).json({
          error: 'Each deposit and withdrawal method requires name, account name, and account number.',
        });
        return;
      }

      const withdrawalStartHour = Number(body.withdrawalStartHour);
      const withdrawalEndHour = Number(body.withdrawalEndHour);
      const enforceWithdrawalHours = Boolean(body.enforceWithdrawalHours);
      const withdrawalScheduleNote =
        typeof body.withdrawalScheduleNote === 'string'
          ? body.withdrawalScheduleNote.trim()
          : '';
      const minWithdrawalEtb = Number(body.minWithdrawalEtb);
      const minRechargeEtb = Number(body.minRechargeEtb);
      const withdrawalFeePercent = Number(body.withdrawalFeePercent);

      if (
        !Number.isInteger(withdrawalStartHour) ||
        withdrawalStartHour < 0 ||
        withdrawalStartHour > 23 ||
        !Number.isInteger(withdrawalEndHour) ||
        withdrawalEndHour < 0 ||
        withdrawalEndHour > 23
      ) {
        res.status(400).json({ error: 'Withdrawal hours must be between 0 and 23.' });
        return;
      }
      if (
        !Number.isFinite(minWithdrawalEtb) ||
        minWithdrawalEtb < 0 ||
        !Number.isFinite(minRechargeEtb) ||
        minRechargeEtb < 0 ||
        !Number.isFinite(withdrawalFeePercent) ||
        withdrawalFeePercent < 0 ||
        withdrawalFeePercent > 90
      ) {
        res.status(400).json({ error: 'Invalid withdrawal or deposit fee limits.' });
        return;
      }

      const db = getDb();
      const stamp = nowTimestamp();
      db.prepare(
        `UPDATE payment_settings
         SET deposit_methods_json = ?, withdrawal_methods_json = ?,
             withdrawal_start_hour = ?, withdrawal_end_hour = ?,
             enforce_withdrawal_hours = ?, withdrawal_schedule_note = ?,
             min_withdrawal_etb = ?, min_recharge_etb = ?,
             withdrawal_fee_percent = ?, updated_at = ?
         WHERE id = 'default'`
      ).run(
        JSON.stringify(depositMethods),
        JSON.stringify(withdrawalMethods),
        withdrawalStartHour,
        withdrawalEndHour,
        enforceWithdrawalHours ? 1 : 0,
        withdrawalScheduleNote,
        minWithdrawalEtb,
        minRechargeEtb,
        withdrawalFeePercent,
        stamp
      );

      insertAuditLog(
        req.auth!.name,
        'Updated Payment Settings',
        'Deposit & Withdrawal Methods',
        `Window ${withdrawalStartHour}:00–${withdrawalEndHour}:00 · Min Deposit ${minRechargeEtb} ETB · Min Withdraw ${minWithdrawalEtb} ETB`
      );

      res.json(getPaymentSettings(db));
    }
  );

  // Admin Audit Logs
  router.get('/admin/audit-logs', requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    const auditLogs = db
      .prepare(
        'SELECT id, actor, action, target, details, created_at as timestamp FROM audit_logs ORDER BY rowid DESC LIMIT 100'
      )
      .all();
    res.json({ auditLogs });
  });

  // Fallback 404 for unknown /api routes
  router.use((_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  return router;
}
