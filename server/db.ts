import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, normalizePhone } from './auth.ts';

export interface VipPlanConfig {
  id: string;
  tier: string;
  level: number;
  label: string;
  investmentEtb: number;
  dailyIncomeEtb: number;
  cycleDays: number;
}

export const SERVER_VIP_PLANS: VipPlanConfig[] = [
  { id: 'vip-1', tier: 'VIP 1', level: 1, label: 'Starter', investmentEtb: 700, dailyIncomeEtb: 130, cycleDays: 30 },
  { id: 'vip-2', tier: 'VIP 2', level: 2, label: 'Standard', investmentEtb: 1500, dailyIncomeEtb: 300, cycleDays: 30 },
  { id: 'vip-3', tier: 'VIP 3', level: 3, label: 'Growth', investmentEtb: 3000, dailyIncomeEtb: 600, cycleDays: 30 },
  { id: 'vip-4', tier: 'VIP 4', level: 4, label: 'Executive', investmentEtb: 5000, dailyIncomeEtb: 900, cycleDays: 30 },
  { id: 'vip-5', tier: 'VIP 5', level: 5, label: 'Premier', investmentEtb: 15000, dailyIncomeEtb: 2000, cycleDays: 30 },
  { id: 'vip-6', tier: 'VIP 6', level: 6, label: 'Apex', investmentEtb: 25000, dailyIncomeEtb: 5000, cycleDays: 30 },
];

export interface WelfarePlanConfig {
  id: string;
  name: string;
  investmentEtb: number;
  dailyAmountEtb: number;
  durationDays: number;
}

export const SERVER_WELFARE_PLANS: WelfarePlanConfig[] = [
  { id: 'welfare-1', name: 'Plan 1', investmentEtb: 3000, dailyAmountEtb: 1000, durationDays: 5 },
  { id: 'welfare-2', name: 'Plan 2', investmentEtb: 5000, dailyAmountEtb: 1500, durationDays: 5 },
  { id: 'welfare-3', name: 'Plan 3', investmentEtb: 10000, dailyAmountEtb: 3000, durationDays: 5 },
  { id: 'welfare-4', name: 'Plan 4', investmentEtb: 15000, dailyAmountEtb: 4000, durationDays: 7 },
  { id: 'welfare-5', name: 'Plan 5', investmentEtb: 25000, dailyAmountEtb: 7000, durationDays: 7 },
];

export interface PaymentMethodConfig {
  id: string;
  methodName: string;
  accountName: string;
  accountNumber: string;
  enabled: boolean;
}

export interface PaymentSettingsRow {
  depositMethods: PaymentMethodConfig[];
  withdrawalMethods: PaymentMethodConfig[];
  withdrawalStartHour: number;
  withdrawalEndHour: number;
  enforceWithdrawalHours: boolean;
  withdrawalScheduleNote: string;
  minWithdrawalEtb: number;
  minRechargeEtb: number;
  withdrawalFeePercent: number;
  registrationBonusEtb: number;
  dailyCheckInEtb: number;
  level1CommissionPercent: number;
  level2CommissionPercent: number;
  level3CommissionPercent: number;
  updatedAt: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'zentro.db');

let dbInstance: DatabaseSync | null = null;

export function nowTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  seedIfEmpty(db);
  db.prepare(
    "DELETE FROM broadcast_messages WHERE id = 'brd-1' AND title = 'Welcome to ZENTRO'"
  ).run();
  dbInstance = db;
  return db;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_secrets (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      phone_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      status TEXT NOT NULL DEFAULT 'Active',
      invitation_code TEXT NOT NULL UNIQUE,
      invited_by_code TEXT,
      wallet_balance_etb REAL NOT NULL DEFAULT 0,
      total_deposit_etb REAL NOT NULL DEFAULT 0,
      total_withdraw_etb REAL NOT NULL DEFAULT 0,
      total_commission_etb REAL NOT NULL DEFAULT 0,
      last_check_in_at INTEGER,
      terms_accepted INTEGER NOT NULL DEFAULT 0,
      bank_account_name TEXT,
      bank_account_number TEXT,
      bank_method TEXT DEFAULT 'CBE',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchased_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      investment_etb REAL NOT NULL,
      daily_income_etb REAL NOT NULL,
      cycle_days INTEGER NOT NULL,
      purchased_at TEXT NOT NULL,
      next_cycle_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS welfare_enrollments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      investment_etb REAL NOT NULL,
      daily_amount_etb REAL NOT NULL,
      duration_days INTEGER NOT NULL,
      claimed_days INTEGER NOT NULL DEFAULT 0,
      accumulated_etb REAL NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      matures_at_ms INTEGER NOT NULL,
      last_claim_at_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'Active',
      released_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS check_in_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reward_etb REAL NOT NULL,
      claimed_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS deposit_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount_etb REAL NOT NULL,
      reference_code TEXT NOT NULL,
      payment_method_id TEXT NOT NULL,
      payment_method_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      receipt_filename TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      rejection_reason TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount_etb REAL NOT NULL,
      fee_etb REAL NOT NULL,
      net_amount_etb REAL NOT NULL,
      payment_method_id TEXT NOT NULL,
      payment_method_name TEXT NOT NULL,
      customer_account_name TEXT NOT NULL,
      customer_account_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      rejection_reason TEXT,
      reviewed_by TEXT,
      processed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS feedback_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Unread',
      admin_reply TEXT,
      replied_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS broadcast_messages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      image_filename TEXT,
      target_user_id TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      image_filename TEXT,
      type TEXT NOT NULL DEFAULT 'info',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payment_settings (
      id TEXT PRIMARY KEY,
      deposit_methods_json TEXT NOT NULL,
      withdrawal_methods_json TEXT NOT NULL,
      withdrawal_start_hour INTEGER NOT NULL DEFAULT 8,
      withdrawal_end_hour INTEGER NOT NULL DEFAULT 20,
      enforce_withdrawal_hours INTEGER NOT NULL DEFAULT 0,
      withdrawal_schedule_note TEXT NOT NULL,
      min_withdrawal_etb REAL NOT NULL DEFAULT 150,
      min_recharge_etb REAL NOT NULL DEFAULT 700,
      withdrawal_fee_percent REAL NOT NULL DEFAULT 17,
      registration_bonus_etb REAL NOT NULL DEFAULT 150,
      daily_check_in_etb REAL NOT NULL DEFAULT 5,
      level1_commission_percent REAL NOT NULL DEFAULT 15,
      level2_commission_percent REAL NOT NULL DEFAULT 2,
      level3_commission_percent REAL NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      plan_tier TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}

function seedIfEmpty(db: DatabaseSync): void {
  const settingsCount = db
    .prepare('SELECT COUNT(*) as cnt FROM payment_settings')
    .get() as { cnt: number };

  if (settingsCount.cnt === 0) {
    const initialDepositMethods: PaymentMethodConfig[] = [
      {
        id: 'dep-cbe-1',
        methodName: 'CBE',
        accountName: 'ZENTRO Commercial Account',
        accountNumber: '1000456789012',
        enabled: true,
      },
    ];
    const initialWithdrawalMethods: PaymentMethodConfig[] = [
      {
        id: 'wd-cbe-1',
        methodName: 'CBE',
        accountName: 'Customer CBE Account',
        accountNumber: 'Customer Registered CBE',
        enabled: true,
      },
    ];

    db.prepare(`
      INSERT INTO payment_settings (
        id, deposit_methods_json, withdrawal_methods_json,
        withdrawal_start_hour, withdrawal_end_hour, enforce_withdrawal_hours,
        withdrawal_schedule_note, min_withdrawal_etb, min_recharge_etb,
        withdrawal_fee_percent, registration_bonus_etb, daily_check_in_etb,
        level1_commission_percent, level2_commission_percent, level3_commission_percent,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'default',
      JSON.stringify(initialDepositMethods),
      JSON.stringify(initialWithdrawalMethods),
      8,
      20,
      0,
      'Withdrawals process between 08:00 and 20:00 EAT',
      150,
      700,
      17,
      150,
      5,
      15,
      2,
      1,
      nowTimestamp()
    );
  }

  const usersCount = db
    .prepare('SELECT COUNT(*) as cnt FROM users')
    .get() as { cnt: number };

  if (usersCount.cnt === 0) {
    const sampleHash = hashPassword('ZentroMember#2026');
    const insertUser = db.prepare(`
      INSERT INTO users (
        id, name, phone, phone_normalized, password_hash, role, status,
        invitation_code, invited_by_code, wallet_balance_etb,
        total_deposit_etb, total_withdraw_etb, total_commission_etb,
        last_check_in_at, terms_accepted, bank_account_name, bank_account_number,
        bank_method, created_at
      ) VALUES (?, ?, ?, ?, ?, 'customer', ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, 'CBE', ?)
    `);

    insertUser.run(
      'cust-1',
      'Abebe Bikila',
      '+251911223344',
      normalizePhone('+251911223344'),
      sampleHash,
      'Active',
      '482190',
      null,
      1655,
      1500,
      300,
      225,
      'Abebe Bikila',
      '1000234567891',
      '2026-10-12'
    );
    insertUser.run(
      'cust-2',
      'Tigist Tadesse',
      '+251922334455',
      normalizePhone('+251922334455'),
      sampleHash,
      'Active',
      '519032',
      '482190',
      855,
      700,
      0,
      0,
      'Tigist Tadesse',
      '1000987654321',
      '2026-10-19'
    );
    insertUser.run(
      'cust-3',
      'Dawit Mekonnen',
      '+251933445566',
      normalizePhone('+251933445566'),
      sampleHash,
      'Active',
      '603418',
      '482190',
      3160,
      3000,
      0,
      105,
      'Dawit Mekonnen',
      '1000556677889',
      '2026-11-02'
    );
    insertUser.run(
      'cust-4',
      'Hanna Bekele',
      '+251944556677',
      normalizePhone('+251944556677'),
      sampleHash,
      'Suspended',
      '771245',
      '519032',
      150,
      0,
      0,
      0,
      null,
      null,
      '2026-11-11'
    );

    const nowSec = Date.now() + 18 * 3600 * 1000;
    db.prepare(`
      INSERT INTO purchased_plans (
        id, user_id, plan_id, tier, investment_etb, daily_income_etb,
        cycle_days, purchased_at, next_cycle_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('pur-101', 'cust-1', 'vip-2', 'VIP 2', 1500, 300, 30, '2026-11-20', nowSec, 'Active');

    db.prepare(`
      INSERT INTO purchased_plans (
        id, user_id, plan_id, tier, investment_etb, daily_income_etb,
        cycle_days, purchased_at, next_cycle_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('pur-102', 'cust-2', 'vip-1', 'VIP 1', 700, 130, 30, '2026-11-21', nowSec, 'Active');

    db.prepare(`
      INSERT INTO check_in_history (id, user_id, reward_etb, claimed_at)
      VALUES (?, ?, ?, ?)
    `).run('chk-1', 'cust-1', 5, '2026-11-24 09:10');

    db.prepare(`
      INSERT INTO deposit_requests (
        id, user_id, amount_etb, reference_code, payment_method_id,
        payment_method_name, account_name, account_number, receipt_filename,
        status, rejection_reason, reviewed_by, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(
      'dep-101',
      'cust-1',
      1500,
      'CBE-TXN-8821',
      'dep-cbe-1',
      'CBE',
      'ZENTRO Commercial Account',
      '1000456789012',
      '',
      'Approved',
      'Zentro',
      '2026-11-20 10:15',
      '2026-11-20 10:00'
    );

    db.prepare(`
      INSERT INTO withdrawal_requests (
        id, user_id, amount_etb, fee_etb, net_amount_etb, payment_method_id,
        payment_method_name, customer_account_name, customer_account_number,
        status, rejection_reason, reviewed_by, processed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(
      'wd-101',
      'cust-1',
      300,
      51,
      249,
      'wd-cbe-1',
      'CBE',
      'Abebe Bikila',
      '1000234567891',
      'Processed',
      'Zentro',
      '2026-11-22 15:30',
      '2026-11-22 14:10'
    );

    db.prepare(`
      INSERT INTO feedback_messages (
        id, user_id, category, subject, message, status, admin_reply, replied_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'fb-1',
      'cust-2',
      'General Inquiry',
      'Deposit confirmation timing',
      'Please confirm how long CBE receipt verification takes.',
      'Unread',
      null,
      null,
      '2026-11-25 10:15'
    );


    db.prepare(`
      INSERT INTO notifications (id, user_id, title, message, image_filename, type, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      'ntf-1',
      'cust-1',
      'Welcome to ZENTRO',
      'Welcome to ZENTRO! Use your top-right notification icon to view all platform messages.',
      null,
      'broadcast',
      '2026-11-25 08:00'
    );

    db.prepare(`
      INSERT INTO audit_logs (id, actor, action, target, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'aud-1',
      'Zentro',
      'Initialized Payment Settings',
      'CBE Default Configuration',
      'Configured initial CBE deposit and withdrawal methods',
      '2026-11-25 08:00'
    );
  }
}

export function getPaymentSettings(db: DatabaseSync): PaymentSettingsRow {
  const row = db
    .prepare('SELECT * FROM payment_settings WHERE id = ?')
    .get('default') as Record<string, unknown>;

  return {
    depositMethods: JSON.parse(String(row.deposit_methods_json)) as PaymentMethodConfig[],
    withdrawalMethods: JSON.parse(String(row.withdrawal_methods_json)) as PaymentMethodConfig[],
    withdrawalStartHour: Number(row.withdrawal_start_hour),
    withdrawalEndHour: Number(row.withdrawal_end_hour),
    enforceWithdrawalHours: Boolean(row.enforce_withdrawal_hours),
    withdrawalScheduleNote: String(row.withdrawal_schedule_note),
    minWithdrawalEtb: Number(row.min_withdrawal_etb),
    minRechargeEtb: Number(row.min_recharge_etb),
    withdrawalFeePercent: Number(row.withdrawal_fee_percent),
    registrationBonusEtb: Number(row.registration_bonus_etb),
    dailyCheckInEtb: Number(row.daily_check_in_etb),
    level1CommissionPercent: Number(row.level1_commission_percent),
    level2CommissionPercent: Number(row.level2_commission_percent),
    level3CommissionPercent: Number(row.level3_commission_percent),
    updatedAt: String(row.updated_at),
  };
}
