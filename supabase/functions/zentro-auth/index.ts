import { createClient } from "npm:@supabase/supabase-js@2";

const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
if (!serviceKey || !supabaseUrl) throw new Error("Supabase server credentials are missing.");

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const encoder = new TextEncoder();
const SESSION_COOKIE = "zentro_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

const VIP_PLANS = [
  { id: "vip-1", tier: "VIP 1", level: 1, label: "Starter", investmentEtb: 700, dailyIncomeEtb: 130, cycleDays: 30 },
  { id: "vip-2", tier: "VIP 2", level: 2, label: "Standard", investmentEtb: 1500, dailyIncomeEtb: 300, cycleDays: 30 },
  { id: "vip-3", tier: "VIP 3", level: 3, label: "Growth", investmentEtb: 3000, dailyIncomeEtb: 600, cycleDays: 30 },
  { id: "vip-4", tier: "VIP 4", level: 4, label: "Executive", investmentEtb: 5000, dailyIncomeEtb: 900, cycleDays: 30 },
  { id: "vip-5", tier: "VIP 5", level: 5, label: "Premier", investmentEtb: 15000, dailyIncomeEtb: 2000, cycleDays: 30 },
  { id: "vip-6", tier: "VIP 6", level: 6, label: "Apex", investmentEtb: 25000, dailyIncomeEtb: 5000, cycleDays: 30 },
];
const WELFARE_PLANS = [
  { id: "welfare-1", name: "Plan 1", investmentEtb: 3000, dailyAmountEtb: 1000, durationDays: 5 },
  { id: "welfare-2", name: "Plan 2", investmentEtb: 5000, dailyAmountEtb: 1500, durationDays: 5 },
  { id: "welfare-3", name: "Plan 3", investmentEtb: 10000, dailyAmountEtb: 3000, durationDays: 5 },
  { id: "welfare-4", name: "Plan 4", investmentEtb: 15000, dailyAmountEtb: 4000, durationDays: 7 },
  { id: "welfare-5", name: "Plan 5", investmentEtb: 25000, dailyAmountEtb: 7000, durationDays: 7 },
];

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function randomHex(byteCount: number): string {
  const values = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(values, (v) => v.toString(16).padStart(2, "0")).join("");
}
async function getSessionSecret(): Promise<string> {
  const { data: found, error: readError } = await db.from("app_secrets").select("value").eq("key", "session_signing_secret").maybeSingle();
  if (readError) throw readError;
  if (found?.value && String(found.value).length >= 32) return String(found.value);
  const candidate = randomHex(32);
  const { error: writeError } = await db.from("app_secrets").upsert({ key: "session_signing_secret", value: candidate }, { onConflict: "key", ignoreDuplicates: true });
  if (writeError) throw writeError;
  const { data: stored, error: storedError } = await db.from("app_secrets").select("value").eq("key", "session_signing_secret").single();
  if (storedError || !stored?.value) throw storedError || new Error("Unable to initialize session secret.");
  return String(stored.value);
}
async function issueToken(payload: { userId: string; role: "customer" | "admin"; name: string }): Promise<string> {
  const fullPayload = { ...payload, exp: Date.now() + SESSION_MAX_AGE };
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(fullPayload)));
  const secret = await getSessionSecret();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(encoded)));
  return encoded + "." + bytesToBase64Url(signature);
}
async function verifyToken(token: string): Promise<{ userId: string; role: "customer" | "admin"; name: string; exp: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const secret = await getSessionSecret();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, base64UrlToBytes(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    if (!payload || typeof payload.userId !== "string" || (payload.role !== "customer" && payload.role !== "admin") || typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try { return decodeURIComponent(value); } catch { return value; }
  }
  return null;
}
function sessionCookie(token: string): string {
  return SESSION_COOKIE + "=" + encodeURIComponent(token) + "; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax";
}
function clearSessionCookie(): string {
  return SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}
function normalizePhone(raw: string): string {
  const cleaned = raw.trim().replace(/[\s\-()]/g, "");
  if (/^\+?251(9|7)\d{8}$/.test(cleaned)) return "251" + cleaned.replace(/^\+?251/, "");
  if (/^0(9|7)\d{8}$/.test(cleaned)) return "251" + cleaned.slice(1);
  if (/^(9|7)\d{8}$/.test(cleaned)) return "251" + cleaned;
  return cleaned.toLowerCase();
}
function adminUsername(): string {
  return "Zentro";
}
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, key, 256));
  return "pbkdf2-sha256$210000$" + bytesToBase64Url(salt) + "$" + bytesToBase64Url(bits);
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;
  try {
    const salt = base64UrlToBytes(parts[2]);
    const expected = base64UrlToBytes(parts[3]);
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, expected.length * 8));
    if (bits.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
    return diff === 0;
  } catch { return false; }
}
function settingsFromRow(row: Record<string, unknown>) {
  const parseMethods = (value: unknown) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
    return [];
  };
  return {
    depositMethods: parseMethods(row.deposit_methods_json),
    withdrawalMethods: parseMethods(row.withdrawal_methods_json),
    withdrawalStartHour: Number(row.withdrawal_start_hour ?? 4),
    withdrawalEndHour: Number(row.withdrawal_end_hour ?? 23),
    enforceWithdrawalHours: Boolean(row.enforce_withdrawal_hours),
    withdrawalScheduleNote: String(row.withdrawal_schedule_note ?? ""),
    minWithdrawalEtb: Number(row.min_withdrawal_etb ?? 150),
    minRechargeEtb: Number(row.min_recharge_etb ?? 700),
    withdrawalFeePercent: Number(row.withdrawal_fee_percent ?? 17),
    registrationBonusEtb: Number(row.registration_bonus_etb ?? 150),
    dailyCheckInEtb: Number(row.daily_check_in_etb ?? 5),
    level1CommissionPercent: Number(row.level1_commission_percent ?? 15),
    level2CommissionPercent: Number(row.level2_commission_percent ?? 2),
    level3CommissionPercent: Number(row.level3_commission_percent ?? 1),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}
async function getPaymentSettings() {
  let { data, error } = await db.from("payment_settings").select("*").eq("id", "default").maybeSingle();
  if (error) throw error;
  if (!data) {
    const defaults = {
      id: "default", deposit_methods_json: [], withdrawal_methods_json: [],
      withdrawal_start_hour: 4, withdrawal_end_hour: 23, enforce_withdrawal_hours: false,
      withdrawal_schedule_note: "Withdrawals are available from 04:00 to 23:00 Ethiopia time",
      min_withdrawal_etb: 150, min_recharge_etb: 700, withdrawal_fee_percent: 17,
      registration_bonus_etb: 150, daily_check_in_etb: 5,
      level1_commission_percent: 15, level2_commission_percent: 2, level3_commission_percent: 1,
    };
    const result = await db.from("payment_settings").upsert(defaults, { onConflict: "id", ignoreDuplicates: true });
    if (result.error) throw result.error;
    const reread = await db.from("payment_settings").select("*").eq("id", "default").single();
    if (reread.error) throw reread.error;
    data = reread.data;
  }
  return settingsFromRow(data as Record<string, unknown>);
}
async function getAuth(req: Request) {
  const bearer = req.headers.get("authorization");
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7).trim() : parseCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  if (payload.role === "admin") return payload;
  const { data: user, error } = await db.from("users").select("id,status").eq("id", payload.userId).maybeSingle();
  if (error || !user || user.status === "Suspended") return null;
  return payload;
}
async function getCustomerProfile(userId: string) {
  const { data: user, error: userError } = await db.from("users").select("*").eq("id", userId).maybeSingle();
  if (userError) throw userError;
  if (!user) return null;
  const [purchasedRes, welfareRes, checkRes, depositRes, withdrawalRes, notificationRes, feedbackRes, activityRes, broadcastsRes, teamRes, allPlansRes] = await Promise.all([
    db.from("purchased_plans").select("*").eq("user_id", userId).order("purchased_at", { ascending: false }),
    db.from("welfare_enrollments").select("*").eq("user_id", userId).order("started_at", { ascending: false }),
    db.from("check_in_history").select("*").eq("user_id", userId).order("claimed_at", { ascending: false }).limit(20),
    db.from("deposit_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("withdrawal_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    db.from("feedback_messages").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("activities").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    db.from("broadcast_messages").select("*").is("target_user_id", null).order("created_at", { ascending: false }).limit(1),
    db.from("users").select("id,name,phone,invitation_code,invited_by_code,created_at").eq("role", "customer"),
    db.from("purchased_plans").select("user_id,tier,purchased_at").order("purchased_at", { ascending: false }),
  ]);
  for (const result of [purchasedRes,welfareRes,checkRes,depositRes,withdrawalRes,notificationRes,feedbackRes,activityRes,broadcastsRes,teamRes,allPlansRes]) if (result.error) throw result.error;

  const plansByUser = new Map<string, string>();
  for (const plan of (allPlansRes.data || [])) if (!plansByUser.has(plan.user_id)) plansByUser.set(plan.user_id, plan.tier);
  const members = teamRes.data || [];
  const level1 = members.filter((member) => member.invited_by_code === user.invitation_code);
  const level1Codes = new Set(level1.map((member) => member.invitation_code));
  const level2 = members.filter((member) => member.invited_by_code && level1Codes.has(member.invited_by_code));
  const level2Codes = new Set(level2.map((member) => member.invitation_code));
  const level3 = members.filter((member) => member.invited_by_code && level2Codes.has(member.invited_by_code));
  const teamMembers = [
    ...level1.map((member) => ({ id: member.id, name: member.name, phone: member.phone, registeredAt: member.created_at, tier: plansByUser.get(member.id) || "Member", level: 1, invitedBy: "Direct" })),
    ...level2.map((member) => ({ id: member.id, name: member.name, phone: member.phone, registeredAt: member.created_at, tier: plansByUser.get(member.id) || "Member", level: 2, invitedBy: "Team" })),
    ...level3.map((member) => ({ id: member.id, name: member.name, phone: member.phone, registeredAt: member.created_at, tier: plansByUser.get(member.id) || "Member", level: 3, invitedBy: "Team" })),
  ];
  const settings = await getPaymentSettings();
  return {
    user: {
      id: user.id, name: user.name, phone: user.phone, role: "customer", status: user.status,
      invitationCode: user.invitation_code, invitedByCode: user.invited_by_code || undefined,
      walletBalanceEtb: Number(user.wallet_balance_etb), totalDepositEtb: Number(user.total_deposit_etb),
      totalWithdrawEtb: Number(user.total_withdraw_etb), totalCommissionEtb: Number(user.total_commission_etb),
      lastCheckInAt: user.last_check_in_at === null ? null : Number(user.last_check_in_at),
      termsAccepted: Boolean(user.terms_accepted), registeredAt: user.created_at,
      bankAccount: user.bank_account_number ? { accountName: user.bank_account_name || "", accountNumber: user.bank_account_number, method: user.bank_method || "CBE" } : undefined,
    },
    purchasedPlans: (purchasedRes.data || []).map((p) => ({ id: p.id, planId: p.plan_id, tier: p.tier, investmentEtb: Number(p.investment_etb), dailyIncomeEtb: Number(p.daily_income_etb), cycleDays: p.cycle_days, purchaseDate: p.purchased_at, nextCycleAt: Number(p.next_cycle_at), status: p.status })),
    welfareEnrollments: (welfareRes.data || []).map((w) => ({ id: w.id, planId: w.plan_id, planName: w.plan_name, investmentEtb: Number(w.investment_etb), dailyAmountEtb: Number(w.daily_amount_etb), durationDays: w.duration_days, claimedDays: w.claimed_days, accumulatedEtb: Number(w.accumulated_etb), startedAt: w.started_at, startedAtMs: Number(w.started_at_ms), maturesAtMs: Number(w.matures_at_ms), lastClaimAtMs: w.last_claim_at_ms === null ? null : Number(w.last_claim_at_ms), status: w.status, releasedAt: w.released_at })),
    checkInHistory: (checkRes.data || []).map((c) => ({ id: c.id, timestamp: c.claimed_at, rewardEtb: Number(c.reward_etb) })),
    deposits: (depositRes.data || []).map((d) => ({ id: d.id, amountEtb: Number(d.amount_etb), referenceCode: d.reference_code, paymentMethodName: d.payment_method_name, accountName: d.account_name, accountNumber: d.account_number, receiptFilename: d.receipt_filename, status: d.status, rejectionReason: d.rejection_reason, createdAt: d.created_at })),
    withdrawals: (withdrawalRes.data || []).map((w) => ({ id: w.id, amountEtb: Number(w.amount_etb), feeEtb: Number(w.fee_etb), netAmountEtb: Number(w.net_amount_etb), paymentMethodName: w.payment_method_name, customerAccountName: w.customer_account_name, customerAccountNumber: w.customer_account_number, status: w.status, rejectionReason: w.rejection_reason, createdAt: w.created_at, processedAt: w.processed_at })),
    notifications: (notificationRes.data || []).map((n) => ({ id: n.id, title: n.title, message: n.message, imageFilename: n.image_filename, type: n.type, isRead: Boolean(n.is_read), createdAt: n.created_at })),
    activeBroadcast: broadcastsRes.data?.[0] ? { id: broadcastsRes.data[0].id, title: broadcastsRes.data[0].title, message: broadcastsRes.data[0].message, imageFilename: broadcastsRes.data[0].image_filename, createdBy: broadcastsRes.data[0].created_by, createdAt: broadcastsRes.data[0].created_at } : null,
    feedbackMessages: (feedbackRes.data || []).map((f) => ({ id: f.id, category: f.category, subject: f.subject, message: f.message, status: f.status, adminReply: f.admin_reply, repliedAt: f.replied_at, createdAt: f.created_at })),
    activities: (activityRes.data || []).map((a) => ({ id: a.id, action: a.action, planTier: a.plan_tier, status: a.status, timestamp: a.created_at })),
    teamMembers,
    paymentSettings: settings,
    vipPlans: VIP_PLANS,
    welfarePlans: WELFARE_PLANS,
  };
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let route = url.pathname;
  const marker = "/functions/v1/zentro-auth";
  const markerIndex = route.indexOf(marker);
  if (markerIndex >= 0) route = route.slice(markerIndex + marker.length) || "/";
  if (route.startsWith("/api/")) route = route.slice(4);
  if (route === "/api") route = "/";
  const method = req.method.toUpperCase();

  if (method === "GET" && route === "/payment-settings") {
    const settings = await getPaymentSettings();
    return json({ ...settings, vipPlans: VIP_PLANS, welfarePlans: WELFARE_PLANS });
  }
  if (method === "GET" && route === "/auth/admin-bootstrap-status") {
    const { data, error } = await db.from("app_secrets").select("key").eq("key", "admin_password_hash").maybeSingle();
    if (error) throw error;
    return json({ configured: Boolean(data), adminUsername: adminUsername() });
  }
  if (method === "POST" && route === "/auth/admin-bootstrap") {
    return json({ error: "Admin password is already configured." }, 409);
  }
  if (method === "POST" && route === "/auth/logout") {
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }
  if (method === "GET" && route === "/auth/session") {
    const token = parseCookie(req.headers.get("cookie"), SESSION_COOKIE);
    if (!token) return json({ authenticated: false });
    const payload = await verifyToken(token);
    if (!payload) return json({ authenticated: false }, 200, { "set-cookie": clearSessionCookie() });
    if (payload.role === "admin") {
      const refreshed = await issueToken({ userId: "admin-1", role: "admin", name: adminUsername() });
      return json({ authenticated: true, token: refreshed, user: { id: "admin-1", name: adminUsername(), phone: adminUsername(), role: "admin" } }, 200, { "set-cookie": sessionCookie(refreshed) });
    }
    const { data: user, error } = await db.from("users").select("id,name,phone,status,terms_accepted").eq("id", payload.userId).maybeSingle();
    if (error) throw error;
    if (!user || user.status === "Suspended") return json({ authenticated: false }, 200, { "set-cookie": clearSessionCookie() });
    const refreshed = await issueToken({ userId: user.id, role: "customer", name: user.name });
    return json({ authenticated: true, token: refreshed, user: { id: user.id, name: user.name, phone: user.phone, role: "customer", termsAccepted: Boolean(user.terms_accepted) } }, 200, { "set-cookie": sessionCookie(refreshed) });
  }
  if (method === "POST" && route === "/auth/login") {
    const body = await req.json().catch(() => ({}));
    const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!identifier || !password) return json({ error: "Enter your phone number or name and password." }, 400);
    if (identifier.toLowerCase() === adminUsername().toLowerCase()) {
      const { data: secret, error } = await db.from("app_secrets").select("value").eq("key", "admin_password_hash").maybeSingle();
      if (error) throw error;
      if (!secret?.value || !(await verifyPassword(password, String(secret.value)))) return json({ error: "Invalid credentials." }, 401);
      const token = await issueToken({ userId: "admin-1", role: "admin", name: adminUsername() });
      return json({ token, user: { id: "admin-1", name: adminUsername(), phone: adminUsername(), role: "admin" } }, 200, { "set-cookie": sessionCookie(token) });
    }
    const normalized = normalizePhone(identifier);
    let query = await db.from("users").select("id,name,phone,password_hash,role,status,terms_accepted").eq("phone_normalized", normalized).maybeSingle();
    if (!query.data && !query.error) query = await db.from("users").select("id,name,phone,password_hash,role,status,terms_accepted").ilike("name", identifier).limit(1).maybeSingle();
    if (query.error) throw query.error;
    const user = query.data;
    if (!user || !(await verifyPassword(password, String(user.password_hash)))) return json({ error: "Invalid credentials." }, 401);
    if (user.status === "Suspended") return json({ error: "Account suspended. Contact Support." }, 403);
    const token = await issueToken({ userId: user.id, role: "customer", name: user.name });
    return json({ token, user: { id: user.id, name: user.name, phone: user.phone, role: "customer", termsAccepted: Boolean(user.terms_accepted) } }, 200, { "set-cookie": sessionCookie(token) });
  }
  if (method === "POST" && route === "/auth/register") {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
    const invitationCode = typeof body.invitationCode === "string" ? body.invitationCode.trim() : "";
    if (name.length < 2) return json({ error: "Name must be at least 2 characters." }, 400);
    if (name.toLowerCase() === adminUsername().toLowerCase()) return json({ error: "This name is reserved." }, 400);
    if (phone.replace(/\D/g, "").length < 9) return json({ error: "Enter a valid phone number." }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);
    if (password !== confirmPassword) return json({ error: "Passwords do not match." }, 400);
    if (invitationCode && !/^\d{4,10}$/.test(invitationCode)) return json({ error: "Invitation code must be numeric." }, 400);
    const normalized = normalizePhone(phone);
    const existingPhone = await db.from("users").select("id").eq("phone_normalized", normalized).maybeSingle();
    if (existingPhone.error) throw existingPhone.error;
    const { data: allUsers, error: allUsersError } = await db.from("users").select("id,name").limit(10000);
    if (allUsersError) throw allUsersError;
    if (existingPhone.data || (allUsers || []).some((u) => String(u.name).trim().toLowerCase() === name.toLowerCase())) {
      return json({ error: "Account already exists. Please login instead." }, 409);
    }
    const settings = await getPaymentSettings();
    let inviteCode = "";
    for (let attempt = 0; attempt < 30; attempt++) {
      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      const candidate = String(100000 + (random[0] % 900000));
      const found = await db.from("users").select("id").eq("invitation_code", candidate).maybeSingle();
      if (found.error) throw found.error;
      if (!found.data) { inviteCode = candidate; break; }
    }
    if (!inviteCode) return json({ error: "Unable to allocate an invitation code. Please retry." }, 503);
    const userId = "cust-" + crypto.randomUUID().slice(0, 8);
    const passwordHash = await hashPassword(password);
    const { data: user, error: insertError } = await db.from("users").insert({
      id: userId, name, phone, phone_normalized: normalized, password_hash: passwordHash,
      role: "customer", status: "Active", invitation_code: inviteCode,
      invited_by_code: invitationCode || null, wallet_balance_etb: settings.registrationBonusEtb,
      total_deposit_etb: 0, total_withdraw_etb: 0, total_commission_etb: 0, terms_accepted: false,
    }).select("id,name,phone,role,terms_accepted").single();
    if (insertError) {
      if (insertError.code === "23505") return json({ error: "Account already exists. Please login instead." }, 409);
      throw insertError;
    }
    const stamp = new Date().toISOString();
    await db.from("activities").insert({ id: "act-" + crypto.randomUUID().slice(0, 8), user_id: userId, action: "Registered (" + settings.registrationBonusEtb + " ETB Bonus)", plan_tier: "Member", status: "Completed", created_at: stamp });
    await db.from("notifications").insert({ id: "ntf-" + crypto.randomUUID().slice(0, 8), user_id: userId, title: "Welcome to ZENTRO", message: "Welcome " + name + "! Your account has been created with a " + settings.registrationBonusEtb + " ETB registration bonus.", type: "info", is_read: false, created_at: stamp });
    const token = await issueToken({ userId, role: "customer", name });
    return json({ token, user: { id: user.id, name: user.name, phone: user.phone, role: "customer", termsAccepted: false } }, 201, { "set-cookie": sessionCookie(token) });
  }
  if (method === "GET" && route === "/me") {
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    if (auth.role !== "customer") return json({ error: "Customer account required." }, 403);
    const profile = await getCustomerProfile(auth.userId);
    return profile ? json(profile) : json({ error: "User not found." }, 404);
  }
  if (method === "POST" && route === "/me/accept-terms") {
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    if (auth.role !== "customer") return json({ error: "Customer account required." }, 403);
    const { error } = await db.from("users").update({ terms_accepted: true }).eq("id", auth.userId);
    if (error) throw error;
    return json({ ok: true });
  }
  if (method === "POST" && route === "/me/bank-account") {
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    if (auth.role !== "customer") return json({ error: "Customer account required." }, 403);
    const body = await req.json().catch(() => ({}));
    const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
    const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.replace(/\s+/g, "") : "";
    const method = typeof body.method === "string" && body.method.trim() ? body.method.trim() : "CBE";
    if (accountName.length < 2) return json({ error: "Enter account holder name." }, 400);
    if (!/^\d{8,18}$/.test(accountNumber)) return json({ error: "Account number must be 8–18 digits." }, 400);
    const { error } = await db.from("users").update({ bank_account_name: accountName, bank_account_number: accountNumber, bank_method: method }).eq("id", auth.userId);
    if (error) throw error;
    return json({ ok: true, bankAccount: { accountName, accountNumber, method } });
  }
  if (method === "POST" && route === "/notifications/read") {
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    const body = await req.json().catch(() => ({}));
    let query = db.from("notifications").update({ is_read: true }).eq("user_id", auth.userId);
    if (typeof body.notificationId === "string" && body.notificationId) query = query.eq("id", body.notificationId);
    const { error } = await query;
    if (error) throw error;
    return json({ ok: true });
  }
  if (route.startsWith("/plans/") || route.startsWith("/welfare/") || route === "/deposits" || route === "/withdrawals") {
    return json({ error: "Financial transactions are disabled on this preview until the production accounting and transfer controls have been verified." }, 503);
  }
  return json({ error: "This API endpoint is not enabled in the current preview deployment.", route }, 501);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  try {
    return await handle(req);
  } catch (error) {
    console.error("ZENTRO API error:", error);
    return json({ error: "The server could not complete this request. Please try again." }, 500);
  }
});