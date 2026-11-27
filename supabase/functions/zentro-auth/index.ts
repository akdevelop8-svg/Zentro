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

// Hard release lock: plan transactions stay disabled until isolated staging validation is complete.
const PLAN_ACTIONS_RELEASED = true;
const REWARD_CLAIMS_RELEASED = true;
const GIFT_CODE_REDEMPTION_RELEASED = true;
const REGISTRATION_BONUS_RELEASED = true;
const TEAM_COMMISSION_RELEASED = true;

// Financial/admin mutations are enabled only on the release-preflight Preview host.
// The production domains continue to fail closed until Preview acceptance is complete.
const PREVIEW_ALLOWED_HOSTS = new Set([
  "zentro-git-release-preflight-akdevelop8-svg.vercel.app"
]);
function isAllowedPreviewRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && PREVIEW_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

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
async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function issueToken(payload: { userId: string; role: "customer" | "admin"; name: string }): Promise<string> {
  const sessionId = crypto.randomUUID();
  const fullPayload = { ...payload, sid: sessionId, exp: Date.now() + SESSION_MAX_AGE };
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(fullPayload)));
  const secret = await getSessionSecret();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(encoded)));
  const token = encoded + "." + bytesToBase64Url(signature);
  const { error } = await db.from("auth_sessions").insert({
    id: sessionId, user_id: payload.userId, role: payload.role,
    token_hash: await sha256Hex(token), expires_at: new Date(fullPayload.exp).toISOString()
  });
  if (error) throw error;
  await db.from("auth_sessions").delete().lt("expires_at", new Date(Date.now() - SESSION_MAX_AGE).toISOString());
  await db.from("auth_attempts").delete().lt("attempted_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  return token;
}
async function verifyToken(token: string): Promise<{ userId: string; role: "customer" | "admin"; name: string; exp: number; sid: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const secret = await getSessionSecret();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, base64UrlToBytes(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    if (!payload || typeof payload.userId !== "string" || (payload.role !== "customer" && payload.role !== "admin") || typeof payload.exp !== "number" || payload.exp <= Date.now() || typeof payload.sid !== "string") return null;
    const { data: session, error } = await db.from("auth_sessions").select("id")
      .eq("id", payload.sid).eq("user_id", payload.userId).eq("role", payload.role)
      .eq("token_hash", await sha256Hex(token)).is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !session) return null;
    return payload;
  } catch {
    return null;
  }
}
async function revokeToken(token: string): Promise<void> {
  const payload = await verifyToken(token);
  if (!payload) return;
  const { error } = await db.from("auth_sessions").update({ revoked_at: new Date().toISOString() })
    .eq("id", payload.sid).is("revoked_at", null);
  if (error) throw error;
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
function requestIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")?.trim()
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || "";
}
async function authRateKeys(identifier: string, ip: string) {
  return {
    identifierHash: await sha256Hex("zentro-auth-id:" + identifier.toLowerCase()),
    ipHash: await sha256Hex("zentro-auth-ip:" + (ip || "unknown:" + identifier.toLowerCase()))
  };
}
async function isAuthRateLimited(action: "login" | "register", identifier: string, ip: string, windowMs: number, perIdentifier: number, perIp: number): Promise<boolean> {
  const keys = await authRateKeys(identifier, ip);
  const since = new Date(Date.now() - windowMs).toISOString();
  const [byIdentifier, byIp] = await Promise.all([
    db.from("auth_attempts").select("id", { count: "exact", head: true }).eq("action", action).eq("identifier_hash", keys.identifierHash).gte("attempted_at", since),
    db.from("auth_attempts").select("id", { count: "exact", head: true }).eq("action", action).eq("ip_hash", keys.ipHash).gte("attempted_at", since)
  ]);
  if (byIdentifier.error) throw byIdentifier.error;
  if (byIp.error) throw byIp.error;
  return (byIdentifier.count || 0) >= perIdentifier || (byIp.count || 0) >= perIp;
}
async function recordAuthAttempt(action: "login" | "register", identifier: string, ip: string): Promise<void> {
  const keys = await authRateKeys(identifier, ip);
  const { error } = await db.from("auth_attempts").insert({ action, identifier_hash: keys.identifierHash, ip_hash: keys.ipHash });
  if (error) throw error;
}
type DecodedImage = { ok: true; bytes: Uint8Array; mime: string; extension: string } | { ok: false; error: string; status: number };
function decodeImageDataUrl(value: string): DecodedImage {
  if (value.length > 3_000_000) return { ok: false, error: "Image must be 2 MB or smaller.", status: 413 };
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return { ok: false, error: "Upload a valid JPEG, PNG, or WebP image.", status: 400 };
  let binary = "";
  try { binary = atob(match[2]); } catch { return { ok: false, error: "Image data is invalid.", status: 400 }; }
  if (!binary.length || binary.length > 2 * 1024 * 1024) return { ok: false, error: "Image must be 2 MB or smaller.", status: 413 };
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const mime = match[1].toLowerCase();
  const isPng = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  const isJpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isWebp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
  if ((mime === "image/png" && !isPng) || (mime === "image/jpeg" && !isJpeg) || (mime === "image/webp" && !isWebp)) {
    return { ok: false, error: "Image content does not match its declared file type.", status: 400 };
  }
  return { ok: true, bytes, mime, extension: mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp" };
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
    level3CommissionPercent: Number(row.level3_commission_percent ?? 0),
    commissionBase: String(row.commission_base ?? "none"),
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
      level1_commission_percent: 0, level2_commission_percent: 0, level3_commission_percent: 0,
      commission_base: "none",
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
  const { error: expiryError } = await db.from("purchased_plans")
    .update({ status: "Expired" })
    .eq("user_id", userId)
    .eq("status", "Active")
    .lt("expires_at", new Date().toISOString());
  if (expiryError) throw expiryError;

  const [purchasedRes, welfareRes, checkRes, depositRes, withdrawalRes, notificationRes, feedbackRes, activityRes, broadcastsRes, teamRes, allPlansRes] = await Promise.all([
    db.from("purchased_plans").select("*").eq("user_id", userId).order("purchased_at", { ascending: false }),
    db.from("welfare_enrollments").select("*").eq("user_id", userId).order("started_at", { ascending: false }),
    db.from("check_in_history").select("*").eq("user_id", userId).order("claimed_at", { ascending: false }).limit(20),
    db.from("deposit_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("withdrawal_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    db.from("feedback_messages").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("activities").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    db.from("broadcast_messages").select("*").or("target_user_id.is.null,target_user_id.eq." + userId).order("created_at", { ascending: false }).limit(1),
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
    purchasedPlans: (purchasedRes.data || []).map((p) => ({
      id: p.id, planId: p.plan_id, tier: p.tier,
      investmentEtb: Number(p.investment_etb), dailyIncomeEtb: Number(p.daily_income_etb),
      cycleDays: p.cycle_days, claimedDays: Number(p.claimed_days || 0),
      purchaseDate: p.purchased_at, nextCycleAt: Number(p.next_cycle_at),
      expiresAtMs: new Date(p.expires_at).getTime(), status: p.status
    })),
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
  const originalPath = url.pathname;
  let normalizedPath = originalPath;
  while (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
    normalizedPath = normalizedPath.slice(0, -1);
  }
  const knownSuffixes = [
    "/admin/payment-settings",
    "/auth/admin-bootstrap-status",
    "/auth/admin-bootstrap",
    "/auth/session",
    "/auth/logout",
    "/auth/login",
    "/auth/register",
    "/payment-settings",
    "/me/accept-terms",
    "/me/bank-account",
    "/notifications/read",
    "/me",
  ];
  // Vercel's external rewrite can leave the full /functions/v1/... prefix
  // in the Edge request URL. Match known endpoint suffixes independent of prefix.
  const matchedSuffix = knownSuffixes.find((suffix) => normalizedPath.endsWith(suffix));
  let route: string;
  if (matchedSuffix) {
    route = matchedSuffix;
  } else {
    const segments = normalizedPath.split("/").filter(Boolean);
    const functionIndex = segments.lastIndexOf("zentro-auth");
    const apiIndex = segments.lastIndexOf("api");
    const suffixSegments = functionIndex >= 0
      ? segments.slice(functionIndex + 1)
      : apiIndex >= 0
        ? segments.slice(apiIndex + 1)
        : segments;
    route = "/" + suffixSegments.join("/");
  }
  const method = req.method.toUpperCase();
  console.log("ZENTRO_API_ROUTE", JSON.stringify({ method, originalPath, route }));

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
    const bearer = req.headers.get("authorization");
    const token = bearer?.startsWith("Bearer ") ? bearer.slice(7).trim() : parseCookie(req.headers.get("cookie"), SESSION_COOKIE);
    if (token) await revokeToken(token);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }
  if (method === "GET" && route === "/auth/session") {
    const token = parseCookie(req.headers.get("cookie"), SESSION_COOKIE);
    if (!token) return json({ authenticated: false });
    const payload = await verifyToken(token);
    if (!payload) return json({ authenticated: false }, 200, { "set-cookie": clearSessionCookie() });
    if (payload.role === "admin") {
      await revokeToken(token);
      const refreshed = await issueToken({ userId: "admin-1", role: "admin", name: adminUsername() });
      return json({ authenticated: true, token: refreshed, user: { id: "admin-1", name: adminUsername(), phone: adminUsername(), role: "admin" } }, 200, { "set-cookie": sessionCookie(refreshed) });
    }
    const { data: user, error } = await db.from("users").select("id,name,phone,status,terms_accepted").eq("id", payload.userId).maybeSingle();
    if (error) throw error;
    if (!user || user.status === "Suspended") {
      await revokeToken(token);
      return json({ authenticated: false }, 200, { "set-cookie": clearSessionCookie() });
    }
    await revokeToken(token);
    const refreshed = await issueToken({ userId: user.id, role: "customer", name: user.name });
    return json({ authenticated: true, token: refreshed, user: { id: user.id, name: user.name, phone: user.phone, role: "customer", termsAccepted: Boolean(user.terms_accepted) } }, 200, { "set-cookie": sessionCookie(refreshed) });
  }
  if (method === "POST" && route === "/auth/login") {
    const body = await req.json().catch(() => ({}));
    const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!identifier || !password) return json({ error: "Enter your phone number or name and password." }, 400);
    const loginKey = identifier.toLowerCase() === adminUsername().toLowerCase() ? "admin:" + adminUsername() : normalizePhone(identifier);
    const ip = requestIp(req);
    if (await isAuthRateLimited("login", loginKey, ip, 15 * 60 * 1000, 8, 30)) {
      return json({ error: "Too many sign-in attempts. Please try again in 15 minutes." }, 429, { "retry-after": "900" });
    }
    if (identifier.toLowerCase() === adminUsername().toLowerCase()) {
      const { data: secret, error } = await db.from("app_secrets").select("value").eq("key", "admin_password_hash").maybeSingle();
      if (error) throw error;
      if (!secret?.value || !(await verifyPassword(password, String(secret.value)))) {
        await recordAuthAttempt("login", loginKey, ip);
        return json({ error: "Invalid credentials." }, 401);
      }
      const token = await issueToken({ userId: "admin-1", role: "admin", name: adminUsername() });
      return json({ token, user: { id: "admin-1", name: adminUsername(), phone: adminUsername(), role: "admin" } }, 200, { "set-cookie": sessionCookie(token) });
    }
    const normalized = normalizePhone(identifier);
    let query = await db.from("users").select("id,name,phone,password_hash,role,status,terms_accepted").eq("phone_normalized", normalized).maybeSingle();
    if (!query.data && !query.error) query = await db.from("users").select("id,name,phone,password_hash,role,status,terms_accepted").ilike("name", identifier).limit(1).maybeSingle();
    if (query.error) throw query.error;
    const user = query.data;
    if (!user || !(await verifyPassword(password, String(user.password_hash)))) {
      await recordAuthAttempt("login", loginKey, ip);
      return json({ error: "Invalid credentials." }, 401);
    }
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
    if (!/^251[79]\d{8}$/.test(normalized)) return json({ error: "Enter a valid Ethiopian mobile number." }, 400);
    const ip = requestIp(req);
    if (await isAuthRateLimited("register", normalized, ip, 60 * 60 * 1000, 3, 10)) {
      return json({ error: "Too many registration attempts. Please try again in one hour." }, 429, { "retry-after": "3600" });
    }
    await recordAuthAttempt("register", normalized, ip);
    if (invitationCode) {
      const { data: inviter, error: inviterError } = await db.from("users").select("id").eq("invitation_code", invitationCode).eq("role", "customer").maybeSingle();
      if (inviterError) throw inviterError;
      if (!inviter) return json({ error: "Invitation code was not found." }, 400);
    }
    const existingPhone = await db.from("users").select("id").eq("phone_normalized", normalized).maybeSingle();
    if (existingPhone.error) throw existingPhone.error;
    const { data: allUsers, error: allUsersError } = await db.from("users").select("id,name").limit(10000);
    if (allUsersError) throw allUsersError;
    if (existingPhone.data || (allUsers || []).some((u) => String(u.name).trim().toLowerCase() === name.toLowerCase())) {
      return json({ error: "Account already exists. Please login instead." }, 409);
    }
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
      invited_by_code: invitationCode || null, wallet_balance_etb: 0,
      total_deposit_etb: 0, total_withdraw_etb: 0, total_commission_etb: 0, terms_accepted: false,
    }).select("id,name,phone,role,terms_accepted").single();
    if (insertError) {
      if (insertError.code === "23505") return json({ error: "Account already exists. Please login instead." }, 409);
      throw insertError;
    }
    const stamp = new Date().toISOString();
    await db.from("activities").insert({ id: "act-" + crypto.randomUUID().slice(0, 8), user_id: userId, action: "Registered", plan_tier: "Member", status: "Completed", created_at: stamp });
    await db.from("notifications").insert({ id: "ntf-" + crypto.randomUUID().slice(0, 8), user_id: userId, title: "Welcome to ZENTRO", message: "Welcome " + name + "! Your ZENTRO account has been created.", type: "info", is_read: false, created_at: stamp });
    if (REGISTRATION_BONUS_RELEASED && isAllowedPreviewRequest(req)) {
      const { error: bonusError } = await db.rpc("zentro_grant_registration_bonus", { p_user_id: userId });
      if (bonusError) console.error("Registration bonus grant failed:", bonusError.message);
    }
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
    if (!isAllowedPreviewRequest(req)) return json({ error: "Bank account updates are available only in the release Preview." }, 403);
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    if (auth.role !== "customer") return json({ error: "Customer account required." }, 403);
    const body = await req.json().catch(() => ({}));
    const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
    const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.replace(/\s+/g, "") : "";
    const method = typeof body.method === "string" && body.method.trim() ? body.method.trim() : "CBE";
    if (accountName.length < 2) return json({ error: "Enter account holder name." }, 400);
    if (!/^\d{8,18}$/.test(accountNumber)) return json({ error: "Account number must be 8–18 digits." }, 400);
    const { data: savedAccount, error: savedAccountError } = await db.from("users")
      .select("bank_account_name,bank_account_number,bank_method")
      .eq("id", auth.userId).maybeSingle();
    if (savedAccountError) throw savedAccountError;
    if (!savedAccount) return json({ error: "Customer account not found." }, 404);
    const alreadySaved = Boolean(savedAccount.bank_account_name || savedAccount.bank_account_number);
    if (alreadySaved) {
      const sameAccount =
        savedAccount.bank_account_name === accountName &&
        savedAccount.bank_account_number === accountNumber &&
        String(savedAccount.bank_method || "CBE").toLowerCase() === method.toLowerCase();
      if (!sameAccount) {
        return json({ error: "Bank account details are locked after the first save. Contact ZENTRO support for a controlled review." }, 409);
      }
      return json({ ok: true, bankAccount: { accountName, accountNumber, method }, locked: true });
    }
    const { error } = await db.from("users").update({
      bank_account_name: accountName,
      bank_account_number: accountNumber,
      bank_method: method
    }).eq("id", auth.userId);
    if (error) {
      if (String(error.code || "") === "23514") {
        return json({ error: "Bank account details are locked after the first save. Contact ZENTRO support for a controlled review." }, 409);
      }
      throw error;
    }
    return json({ ok: true, bankAccount: { accountName, accountNumber, method }, locked: true });
  }

  if (method === "POST" && route === "/deposits") {
    if (!isAllowedPreviewRequest(req)) return json({ error: "Deposit requests are available only in the release Preview." }, 403);
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    if (auth.role !== "customer") return json({ error: "Customer account required." }, 403);
    const body = await req.json().catch(() => ({}));
    const amountEtb = Number(body.amountEtb);
    const referenceCode = typeof body.referenceCode === "string" ? body.referenceCode.trim().toUpperCase() : "";
    const paymentMethodId = typeof body.paymentMethodId === "string" ? body.paymentMethodId.trim() : "";
    const receiptDataUrl = typeof body.receiptDataUrl === "string" ? body.receiptDataUrl : "";
    const settings = await getPaymentSettings();
    if (!Number.isFinite(amountEtb) || Math.abs(amountEtb * 100 - Math.round(amountEtb * 100)) > 0.000001 || amountEtb < settings.minRechargeEtb || amountEtb > 1000000) return json({ error: "Deposit amount must use at most 2 decimal places and be within the allowed limit." }, 400);
    if (!/^[A-Z0-9-]{5,64}$/.test(referenceCode)) return json({ error: "Enter a valid bank transaction reference." }, 400);
    const methods = settings.depositMethods as Array<Record<string, unknown>>;
    const selected = methods.find((m) => m.id === paymentMethodId && m.enabled === true);
    if (!selected) return json({ error: "This deposit method is unavailable. Contact Admin." }, 400);
    const receipt = decodeImageDataUrl(receiptDataUrl);
    if (!receipt.ok) return json({ error: receipt.error }, receipt.status);
    const receiptFilename = crypto.randomUUID() + "." + receipt.extension;
    const { error: uploadError } = await db.storage.from("zentro-deposits").upload(receiptFilename, receipt.bytes, {
      contentType: receipt.mime, cacheControl: "3600", upsert: false
    });
    if (uploadError) throw uploadError;
    const id = "dep-" + crypto.randomUUID().slice(0, 12);
    const { error } = await db.from("deposit_requests").insert({
      id, user_id: auth.userId, amount_etb: amountEtb, reference_code: referenceCode,
      payment_method_id: paymentMethodId, payment_method_name: String(selected.methodName),
      account_name: String(selected.accountName), account_number: String(selected.accountNumber),
      receipt_filename: receiptFilename, status: "Pending"
    });
    if (error) {
      await db.storage.from("zentro-deposits").remove([receiptFilename]);
      if (error.code === "23505") return json({ error: "This bank reference has already been submitted." }, 409);
      throw error;
    }
    await db.from("notifications").insert({
      id: "ntf-" + crypto.randomUUID().slice(0, 12), user_id: auth.userId,
      title: "Deposit request received", message: "Your deposit request for " + amountEtb + " ETB is pending Admin verification.",
      type: "info", is_read: false
    });
    return json({ ok: true, id }, 201);
  }

  if (method === "POST" && route === "/withdrawals") {
    if (!isAllowedPreviewRequest(req)) return json({ error: "Withdrawal requests are available only in the release Preview." }, 403);
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    if (auth.role !== "customer") return json({ error: "Customer account required." }, 403);
    const body = await req.json().catch(() => ({}));
    const amountEtb = Number(body.amountEtb);
    const paymentMethodId = typeof body.paymentMethodId === "string" ? body.paymentMethodId.trim() : "";
    const settings = await getPaymentSettings();
    if (!Number.isFinite(amountEtb) || Math.abs(amountEtb * 100 - Math.round(amountEtb * 100)) > 0.000001 || amountEtb < settings.minWithdrawalEtb || amountEtb > 1000000) return json({ error: "Withdrawal amount must use at most 2 decimal places and be within the allowed limit." }, 400);
    if (!Number.isFinite(settings.withdrawalFeePercent) || settings.withdrawalFeePercent < 0 || settings.withdrawalFeePercent >= 100) return json({ error: "Withdrawal fee settings are invalid. Contact Admin." }, 503);
    if (settings.enforceWithdrawalHours) {
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Addis_Ababa", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
      const inWindow = settings.withdrawalStartHour <= settings.withdrawalEndHour
        ? hour >= settings.withdrawalStartHour && hour < settings.withdrawalEndHour
        : hour >= settings.withdrawalStartHour || hour < settings.withdrawalEndHour;
      if (!inWindow) return json({ error: settings.withdrawalScheduleNote || "Withdrawals are currently outside the processing window." }, 400);
    }
    const { data: user, error: userError } = await db.from("users")
      .select("bank_account_name,bank_account_number,bank_method,status")
      .eq("id", auth.userId).eq("role", "customer").maybeSingle();
    if (userError) throw userError;
    if (!user || user.status !== "Active") return json({ error: "Active customer account not found." }, 404);
    if (!user.bank_account_name || !user.bank_account_number) return json({ error: "Save your bank account details before requesting a withdrawal." }, 400);
    const methods = settings.withdrawalMethods as Array<Record<string, unknown>>;
    const selected = methods.find((m) => m.id === paymentMethodId && m.enabled === true);
    if (!selected || String(selected.methodName).toLowerCase() !== String(user.bank_method || "").toLowerCase()) return json({ error: "Choose the enabled bank method saved on your account." }, 400);
    const feeEtb = Number((amountEtb * settings.withdrawalFeePercent / 100).toFixed(2));
    const netAmountEtb = Number((amountEtb - feeEtb).toFixed(2));
    const id = "wd-" + crypto.randomUUID().slice(0, 12);
    const { data: newBalance, error } = await db.rpc("zentro_request_withdrawal", {
      p_user_id: auth.userId, p_id: id, p_amount: amountEtb, p_fee: feeEtb, p_net: netAmountEtb,
      p_method_id: paymentMethodId, p_method_name: String(selected.methodName),
      p_account_name: user.bank_account_name, p_account_number: user.bank_account_number
    });
    if (error) {
      if (String(error.message || "").includes("Insufficient wallet balance")) return json({ error: "Insufficient wallet balance." }, 400);
      throw error;
    }
    return json({ ok: true, id, walletBalanceEtb: Number(newBalance) }, 201);
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

  // Customer support is available while financial functions remain disabled.
  if (method === "POST" && route === "/support") {
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    if (auth.role !== "customer") return json({ error: "Customer account required." }, 403);
    const body = await req.json().catch(() => ({}));
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!category || !subject || subject.length > 120 || message.length < 5 || message.length > 5000) {
      return json({ error: "Enter a subject and a message between 5 and 5000 characters." }, 400);
    }
    const id = "fb-" + crypto.randomUUID().slice(0, 12);
    const { error } = await db.from("feedback_messages").insert({
      id, user_id: auth.userId, category, subject, message, status: "Unread"
    });
    if (error) throw error;
    return json({ ok: true, id }, 201);
  }

  // All administrative data routes require a signed administrator session.
  if (route.startsWith("/admin/")) {
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Administrator authentication required." }, 401);
    if (auth.role !== "admin") return json({ error: "Administrator access required." }, 403);
    if (method !== "GET" && !isAllowedPreviewRequest(req)) {
      return json({ error: "Administrative changes are available only in the release Preview until acceptance is complete." }, 403);
    }
  }

  if (method === "GET" && route === "/admin/overview") {
    const [customers, active, deposits, withdrawals, unread, broadcasts, audit] = await Promise.all([
      db.from("users").select("id", { count: "exact", head: true }).eq("role", "customer"),
      db.from("users").select("id", { count: "exact", head: true }).eq("role", "customer").eq("status", "Active"),
      db.from("deposit_requests").select("id", { count: "exact", head: true }).eq("status", "Pending"),
      db.from("withdrawal_requests").select("id", { count: "exact", head: true }).eq("status", "Pending"),
      db.from("feedback_messages").select("id", { count: "exact", head: true }).eq("status", "Unread"),
      db.from("broadcast_messages").select("id", { count: "exact", head: true }),
      db.from("audit_logs").select("id,actor,action,target,details,created_at").order("created_at", { ascending: false }).limit(10),
    ]);
    for (const r of [customers, active, deposits, withdrawals, unread, broadcasts, audit]) if (r.error) throw r.error;
    return json({
      totalCustomers: customers.count || 0,
      activeCustomers: active.count || 0,
      pendingDeposits: deposits.count || 0,
      pendingWithdrawals: withdrawals.count || 0,
      unreadFeedback: unread.count || 0,
      totalBroadcasts: broadcasts.count || 0,
      recentAuditLogs: (audit.data || []).map((a) => ({
        id: a.id, actor: a.actor, action: a.action, target: a.target, details: a.details, timestamp: a.created_at
      })),
    });
  }

  if (method === "GET" && route === "/admin/customers") {
    const q = (url.searchParams.get("q") || "").trim();
    const status = url.searchParams.get("status") || "All";
    let query = db.from("users")
      .select("id,name,phone,status,invitation_code,invited_by_code,created_at,bank_account_name,bank_account_number,bank_method")
      .eq("role", "customer")
      .order("created_at", { ascending: false })
      .limit(500);
    if (status === "Active" || status === "Suspended") query = query.eq("status", status);
    if (q) query = query.or("name.ilike.%" + q.replace(/[,%()]/g, " ") + "%,phone.ilike.%" + q.replace(/[,%()]/g, " ") + "%,invitation_code.eq." + q.replace(/[,%()]/g, ""));
    const { data, error } = await query;
    if (error) throw error;
    return json({ customers: (data || []).map((u) => ({
      id: u.id, name: u.name, phone: u.phone, status: u.status,
      invitationCode: u.invitation_code, invitedByCode: u.invited_by_code,
      registeredAt: u.created_at, bankAccountName: u.bank_account_name,
      bankAccountNumber: u.bank_account_number, bankMethod: u.bank_method
    })) });
  }

  const customerDetailMatch = route.match(/^\/admin\/customers\/([^/]+)$/);
  if (method === "GET" && customerDetailMatch) {
    const customerId = decodeURIComponent(customerDetailMatch[1]);
    const [userRes, depositsRes, withdrawalsRes, plansRes, checkRes, feedbackRes, activitiesRes, membersRes] = await Promise.all([
      db.from("users").select("id,name,phone,status,invitation_code,invited_by_code,created_at,bank_account_name,bank_account_number,bank_method,terms_accepted").eq("id", customerId).eq("role", "customer").maybeSingle(),
      db.from("deposit_requests").select("id,amount_etb,reference_code,payment_method_name,status,rejection_reason,created_at").eq("user_id", customerId).order("created_at", { ascending: false }),
      db.from("withdrawal_requests").select("id,amount_etb,fee_etb,net_amount_etb,payment_method_name,customer_account_number,status,rejection_reason,created_at,processed_at").eq("user_id", customerId).order("created_at", { ascending: false }),
      db.from("purchased_plans").select("id,tier,investment_etb,daily_income_etb,cycle_days,purchased_at,status").eq("user_id", customerId).order("purchased_at", { ascending: false }),
      db.from("check_in_history").select("id,claimed_at,reward_etb").eq("user_id", customerId).order("claimed_at", { ascending: false }).limit(50),
      db.from("feedback_messages").select("id,category,subject,message,status,admin_reply,replied_at,created_at").eq("user_id", customerId).order("created_at", { ascending: false }),
      db.from("activities").select("id,action,plan_tier,status,created_at").eq("user_id", customerId).order("created_at", { ascending: false }).limit(50),
      db.from("users").select("id,name,phone,invitation_code,invited_by_code,created_at").eq("role", "customer"),
    ]);
    for (const r of [userRes,depositsRes,withdrawalsRes,plansRes,checkRes,feedbackRes,activitiesRes,membersRes]) if (r.error) throw r.error;
    const u = userRes.data;
    if (!u) return json({ error: "Customer not found." }, 404);
    const inviter = u.invited_by_code ? (membersRes.data || []).find((m) => m.invitation_code === u.invited_by_code) : null;
    const direct = (membersRes.data || []).filter((m) => m.invited_by_code === u.invitation_code);
    const directCodes = new Set(direct.map((m) => m.invitation_code));
    const team = direct.map((m) => ({
      id: m.id, name: m.name, phone: m.phone, registeredAt: m.created_at, tier: "Member", level: 1, invitedBy: "Direct"
    }));
    for (const m of (membersRes.data || [])) {
      if (m.invited_by_code && directCodes.has(m.invited_by_code)) {
        team.push({ id: m.id, name: m.name, phone: m.phone, registeredAt: m.created_at, tier: "Member", level: 2, invitedBy: "Team" });
      }
    }
    return json({
      customer: {
        id: u.id, name: u.name, phone: u.phone, status: u.status,
        invitationCode: u.invitation_code, invitedByCode: u.invited_by_code,
        registeredAt: u.created_at, bankAccountName: u.bank_account_name,
        bankAccountNumber: u.bank_account_number, bankMethod: u.bank_method,
        termsAccepted: Boolean(u.terms_accepted),
        inviter: inviter ? { id: inviter.id, name: inviter.name, phone: inviter.phone, invitationCode: inviter.invitation_code } : null
      },
      deposits: (depositsRes.data || []).map((d) => ({
        id: d.id, amountEtb: Number(d.amount_etb), referenceCode: d.reference_code,
        paymentMethodName: d.payment_method_name, status: d.status,
        rejectionReason: d.rejection_reason, createdAt: d.created_at
      })),
      withdrawals: (withdrawalsRes.data || []).map((w) => ({
        id: w.id, amountEtb: Number(w.amount_etb), feeEtb: Number(w.fee_etb),
        netAmountEtb: Number(w.net_amount_etb), paymentMethodName: w.payment_method_name,
        accountNumber: w.customer_account_number, status: w.status,
        rejectionReason: w.rejection_reason, createdAt: w.created_at, processedAt: w.processed_at
      })),
      purchasedPlans: (plansRes.data || []).map((p) => ({
        id: p.id, tier: p.tier, investmentEtb: Number(p.investment_etb),
        dailyIncomeEtb: Number(p.daily_income_etb), cycleDays: p.cycle_days,
        purchaseDate: p.purchased_at, status: p.status
      })),
      checkInHistory: (checkRes.data || []).map((c) => ({ id: c.id, timestamp: c.claimed_at, rewardEtb: Number(c.reward_etb) })),
      feedback: (feedbackRes.data || []).map((f) => ({
        id: f.id, category: f.category, subject: f.subject, message: f.message,
        status: f.status, adminReply: f.admin_reply, repliedAt: f.replied_at, createdAt: f.created_at
      })),
      activities: (activitiesRes.data || []).map((a) => ({
        id: a.id, action: a.action, planTier: a.plan_tier, status: a.status, timestamp: a.created_at
      })),
      team,
    });
  }

  const customerStatusMatch = route.match(/^\/admin\/customers\/([^/]+)\/status$/);
  if (method === "PATCH" && customerStatusMatch) {
    const customerId = decodeURIComponent(customerStatusMatch[1]);
    const body = await req.json().catch(() => ({}));
    if (body.status !== "Active" && body.status !== "Suspended") return json({ error: "Invalid customer status." }, 400);
    const { data, error } = await db.from("users").update({ status: body.status }).eq("id", customerId).eq("role", "customer").select("status").maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Customer not found." }, 404);
    await db.from("audit_logs").insert({
      id: "aud-" + crypto.randomUUID().slice(0, 12), actor: adminUsername(),
      action: "Customer status changed", target: customerId, details: String(body.status)
    });
    return json({ ok: true, status: data.status });
  }

  if (method === "GET" && route === "/admin/deposits") {
    const [requests, customers] = await Promise.all([
      db.from("deposit_requests").select("*").order("created_at", { ascending: false }).limit(500),
      db.from("users").select("id,name,phone").eq("role", "customer")
    ]);
    if (requests.error) throw requests.error;
    if (customers.error) throw customers.error;
    const users = new Map((customers.data || []).map((u) => [u.id, u]));
    return json({ deposits: (requests.data || []).map((d) => {
      const u = users.get(d.user_id);
      return {
        id: d.id, userId: d.user_id, customerName: u?.name || "Unknown",
        customerPhone: u?.phone || "", amountEtb: Number(d.amount_etb),
        referenceCode: d.reference_code, paymentMethodName: d.payment_method_name,
        accountName: d.account_name, accountNumber: d.account_number,
        receiptFilename: d.receipt_filename, status: d.status,
        rejectionReason: d.rejection_reason, reviewedBy: d.reviewed_by,
        reviewedAt: d.reviewed_at, createdAt: d.created_at
      };
    }) });
  }

  if (method === "GET" && route === "/admin/withdrawals") {
    const [requests, customers] = await Promise.all([
      db.from("withdrawal_requests").select("*").order("created_at", { ascending: false }).limit(500),
      db.from("users").select("id,name,phone").eq("role", "customer")
    ]);
    if (requests.error) throw requests.error;
    if (customers.error) throw customers.error;
    const users = new Map((customers.data || []).map((u) => [u.id, u]));
    return json({ withdrawals: (requests.data || []).map((w) => {
      const u = users.get(w.user_id);
      return {
        id: w.id, userId: w.user_id, customerName: u?.name || "Unknown",
        customerPhone: u?.phone || "", amountEtb: Number(w.amount_etb),
        feeEtb: Number(w.fee_etb), netAmountEtb: Number(w.net_amount_etb),
        paymentMethodName: w.payment_method_name, customerAccountName: w.customer_account_name,
        customerAccountNumber: w.customer_account_number, status: w.status,
        rejectionReason: w.rejection_reason, reviewedBy: w.reviewed_by,
        processedAt: w.processed_at, createdAt: w.created_at
      };
    }) });
  }


  const depositActionMatch = route.match(/^\/admin\/deposits\/([^/]+)\/(approve|reject)$/);
  if (method === "POST" && depositActionMatch) {
    const depositId = decodeURIComponent(depositActionMatch[1]);
    if (depositActionMatch[2] === "approve") {
      const { error } = await db.rpc("zentro_approve_deposit", { p_deposit_id: depositId, p_admin: adminUsername() });
      if (error) throw error;
      return json({ ok: true });
    }
    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 500) return json({ error: "Enter a rejection reason (3–500 characters)." }, 400);
    const { error } = await db.rpc("zentro_reject_deposit", { p_deposit_id: depositId, p_admin: adminUsername(), p_reason: reason });
    if (error) throw error;
    return json({ ok: true });
  }

  const withdrawalActionMatch = route.match(/^\/admin\/withdrawals\/([^/]+)\/(approve|reject|process)$/);
  if (method === "POST" && withdrawalActionMatch) {
    const withdrawalId = decodeURIComponent(withdrawalActionMatch[1]);
    if (withdrawalActionMatch[2] === "approve") {
      const { error } = await db.rpc("zentro_approve_withdrawal", { p_withdrawal_id: withdrawalId, p_admin: adminUsername() });
      if (error) throw error;
      return json({ ok: true });
    }
    if (withdrawalActionMatch[2] === "process") {
      const { error } = await db.rpc("zentro_process_withdrawal", { p_withdrawal_id: withdrawalId, p_admin: adminUsername() });
      if (error) throw error;
      return json({ ok: true });
    }
    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 500) return json({ error: "Enter a rejection reason (3–500 characters)." }, 400);
    const { error } = await db.rpc("zentro_reject_withdrawal", { p_withdrawal_id: withdrawalId, p_admin: adminUsername(), p_reason: reason });
    if (error) throw error;
    return json({ ok: true });
  }

  if (method === "GET" && route === "/admin/gift-codes") {
    const { data, error } = await db.from("gift_codes")
      .select("code,amount_etb,max_redemptions,redemption_count,status,expires_at,created_by,created_at")
      .order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    return json({ giftCodes: (data || []).map((g) => ({
      code: g.code, amountEtb: Number(g.amount_etb), maxRedemptions: g.max_redemptions,
      redemptionCount: g.redemption_count, status: g.status, expiresAt: g.expires_at,
      createdBy: g.created_by, createdAt: g.created_at
    })) });
  }

  if (method === "POST" && route === "/admin/gift-codes") {
    const body = await req.json().catch(() => ({}));
    const amountEtb = Number(body.amountEtb);
    const maxRedemptions = Number(body.maxRedemptions ?? 1);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (!Number.isFinite(amountEtb) || amountEtb <= 0 || amountEtb > 1000000 ||
        Math.abs(amountEtb * 100 - Math.round(amountEtb * 100)) > 0.000001) {
      return json({ error: "Gift code amount must be positive and use at most 2 decimal places." }, 400);
    }
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 10000) {
      return json({ error: "Maximum redemptions must be from 1 to 10,000." }, 400);
    }
    if (body.expiresAt && (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
      return json({ error: "Gift code expiry must be a valid future date." }, 400);
    }
    let code = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = "ZT-" + randomHex(6).toUpperCase();
      const { data: existing, error: lookupError } = await db.from("gift_codes").select("code").eq("code", candidate).maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) { code = candidate; break; }
    }
    if (!code) return json({ error: "Unable to generate a unique gift code. Retry." }, 503);
    const { error } = await db.from("gift_codes").insert({
      code, amount_etb: amountEtb, max_redemptions: maxRedemptions,
      redemption_count: 0, status: "Active", expires_at: expiresAt?.toISOString() ?? null,
      created_by: adminUsername()
    });
    if (error) throw error;
    const { error: auditError } = await db.from("audit_logs").insert({
      id: "aud-" + crypto.randomUUID().slice(0, 12), actor: adminUsername(),
      action: "Gift code created", target: code,
      details: amountEtb + " ETB; max redemptions " + maxRedemptions
    });
    if (auditError) throw auditError;
    return json({ ok: true, giftCode: { code, amountEtb, maxRedemptions, redemptionCount: 0, status: "Active", expiresAt: expiresAt?.toISOString() ?? null } }, 201);
  }

  const giftCodeRevokeMatch = route.match(/^\/admin\/gift-codes\/([^/]+)\/revoke$/);
  if (method === "POST" && giftCodeRevokeMatch) {
    const code = decodeURIComponent(giftCodeRevokeMatch[1]).toUpperCase();
    const { data, error } = await db.from("gift_codes").update({ status: "Revoked" })
      .eq("code", code).eq("status", "Active")
      .select("code").maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Active gift code not found." }, 404);
    const { error: auditError } = await db.from("audit_logs").insert({
      id: "aud-" + crypto.randomUUID().slice(0, 12), actor: adminUsername(),
      action: "Gift code revoked", target: code, details: "Revoked by Admin"
    });
    if (auditError) throw auditError;
    return json({ ok: true, code });
  }

  if (method === "GET" && route === "/admin/feedback") {
    const [feedback, customers] = await Promise.all([
      db.from("feedback_messages").select("*").order("created_at", { ascending: false }).limit(500),
      db.from("users").select("id,name,phone").eq("role", "customer")
    ]);
    if (feedback.error) throw feedback.error;
    if (customers.error) throw customers.error;
    const users = new Map((customers.data || []).map((u) => [u.id, u]));
    return json({ feedback: (feedback.data || []).map((f) => {
      const u = users.get(f.user_id);
      return {
        id: f.id, userId: f.user_id, customerName: u?.name || "Unknown",
        customerPhone: u?.phone || "", category: f.category, subject: f.subject,
        message: f.message, status: f.status, adminReply: f.admin_reply,
        repliedAt: f.replied_at, createdAt: f.created_at
      };
    }) });
  }

  const feedbackStatusMatch = route.match(/^\/admin\/feedback\/([^/]+)\/status$/);
  if (method === "PATCH" && feedbackStatusMatch) {
    const feedbackId = decodeURIComponent(feedbackStatusMatch[1]);
    const body = await req.json().catch(() => ({}));
    if (body.status !== "Read" && body.status !== "Resolved") return json({ error: "Invalid feedback status." }, 400);
    const { error } = await db.from("feedback_messages").update({ status: body.status }).eq("id", feedbackId);
    if (error) throw error;
    return json({ ok: true });
  }

  const feedbackReplyMatch = route.match(/^\/admin\/feedback\/([^/]+)\/reply$/);
  if (method === "POST" && feedbackReplyMatch) {
    const feedbackId = decodeURIComponent(feedbackReplyMatch[1]);
    const body = await req.json().catch(() => ({}));
    const reply = typeof body.reply === "string" ? body.reply.trim() : "";
    if (!reply || reply.length > 5000) return json({ error: "Enter a reply up to 5000 characters." }, 400);
    const { error } = await db.from("feedback_messages")
      .update({ admin_reply: reply, replied_at: new Date().toISOString(), status: "Resolved" })
      .eq("id", feedbackId);
    if (error) throw error;
    return json({ ok: true });
  }

  if (method === "GET" && route === "/admin/broadcasts") {
    const { data, error } = await db.from("broadcast_messages").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    const targetIds = [...new Set((data || []).map((b) => b.target_user_id).filter(Boolean))];
    const targetUsers = targetIds.length
      ? await db.from("users").select("id,name").in("id", targetIds)
      : { data: [], error: null };
    if (targetUsers.error) throw targetUsers.error;
    const users = new Map((targetUsers.data || []).map((u) => [u.id, u.name]));
    return json({ broadcasts: (data || []).map((b) => ({
      id: b.id, title: b.title, message: b.message, imageFilename: b.image_filename,
      targetUserId: b.target_user_id, targetCustomerName: b.target_user_id ? users.get(b.target_user_id) || "Unknown" : null,
      createdBy: b.created_by, createdAt: b.created_at
    })) });
  }

  if (method === "POST" && route === "/admin/broadcasts") {
    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const targetUserId = typeof body.targetUserId === "string" && body.targetUserId ? body.targetUserId : null;
    if (!title || title.length > 120 || !message || message.length > 5000) return json({ error: "Enter a title and message." }, 400);
    if (body.imageDataUrl !== undefined && body.imageDataUrl !== null && typeof body.imageDataUrl !== "string") return json({ error: "Image data must be a base64 data URL." }, 400);
    if (targetUserId) {
      const { data: target, error: targetError } = await db.from("users").select("id").eq("id", targetUserId).eq("role", "customer").maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "Target customer not found." }, 404);
    }
    let imageFilename: string | null = null;
    if (typeof body.imageDataUrl === "string" && body.imageDataUrl.trim()) {
      const parsed = decodeImageDataUrl(body.imageDataUrl);
      if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
      imageFilename = crypto.randomUUID() + "." + parsed.extension;
      const { error: uploadError } = await db.storage.from("zentro-broadcasts").upload(imageFilename, parsed.bytes, {
        contentType: parsed.mime, cacheControl: "3600", upsert: false
      });
      if (uploadError) throw uploadError;
    }
    const id = "bcast-" + crypto.randomUUID().slice(0, 12);
    const { error } = await db.from("broadcast_messages").insert({
      id, title, message, image_filename: imageFilename, target_user_id: targetUserId, created_by: adminUsername()
    });
    if (error) {
      if (imageFilename) await db.storage.from("zentro-broadcasts").remove([imageFilename]);
      throw error;
    }
    const recipients = targetUserId
      ? [{ id: targetUserId }]
      : (await db.from("users").select("id").eq("role", "customer")).data || [];
    if (recipients.length) {
      const notifications = recipients.map((u) => ({
        id: "ntf-" + crypto.randomUUID().slice(0, 12), user_id: u.id,
        title, message, type: "info", is_read: false
      }));
      const notifyResult = await db.from("notifications").insert(notifications);
      if (notifyResult.error) throw notifyResult.error;
    }
    const { error: auditError } = await db.from("audit_logs").insert({
      id: "aud-" + crypto.randomUUID().slice(0, 12), actor: adminUsername(),
      action: "Broadcast created", target: id, details: targetUserId || "all customers"
    });
    if (auditError) throw auditError;
    return json({ ok: true, id, imageFilename }, 201);
  }

  if (method === "GET" && route === "/admin/payment-settings") {
    return json(await getPaymentSettings());
  }

  if (method === "PUT" && route === "/admin/payment-settings") {
    const body = await req.json().catch(() => ({}));
    const row: Record<string, unknown> = { id: "default", updated_at: new Date().toISOString() };
    for (const key of ["depositMethods", "withdrawalMethods"] as const) {
      if (body[key] === undefined) continue;
      if (!Array.isArray(body[key]) || body[key].length > 10) return json({ error: "Payment methods must be arrays with at most 10 entries." }, 400);
      const normalized = [];
      for (const method of body[key]) {
        if (!method || typeof method !== "object") return json({ error: "Invalid payment method." }, 400);
        const id = typeof method.id === "string" ? method.id.trim() : "";
        const methodName = typeof method.methodName === "string" ? method.methodName.trim() : "";
        const accountName = typeof method.accountName === "string" ? method.accountName.trim() : "";
        const accountNumber = typeof method.accountNumber === "string" ? method.accountNumber.replace(/\s+/g, "") : "";
        if (!/^[a-zA-Z0-9_-]{2,40}$/.test(id) || !methodName || methodName.length > 60 ||
            accountName.length < 2 || accountName.length > 100 || !accountNumber || accountNumber.length > 40 ||
            typeof method.enabled !== "boolean") return json({ error: "Complete each bank method with a valid name, account details, and enabled status." }, 400);
        if (key === "depositMethods" && method.enabled && !/^\d{8,18}$/.test(accountNumber)) return json({ error: "Deposit account numbers must contain 8–18 digits." }, 400);
        normalized.push({ id, methodName, accountName, accountNumber, enabled: method.enabled });
      }
      row[key === "depositMethods" ? "deposit_methods_json" : "withdrawal_methods_json"] = normalized;
    }
    const numericMap: Record<string, string> = {
      withdrawalStartHour: "withdrawal_start_hour", withdrawalEndHour: "withdrawal_end_hour",
      minWithdrawalEtb: "min_withdrawal_etb", minRechargeEtb: "min_recharge_etb",
      withdrawalFeePercent: "withdrawal_fee_percent",
      registrationBonusEtb: "registration_bonus_etb",
      dailyCheckInEtb: "daily_check_in_etb",
      level1CommissionPercent: "level1_commission_percent",
      level2CommissionPercent: "level2_commission_percent",
      level3CommissionPercent: "level3_commission_percent"
    };
    for (const [key, column] of Object.entries(numericMap)) {
      if (body[key] === undefined) continue;
      const value = Number(body[key]);
      if (!Number.isFinite(value) || value < 0) return json({ error: "Invalid payment setting: " + key }, 400);
      if ((key === "withdrawalStartHour" || key === "withdrawalEndHour") && (!Number.isInteger(value) || value > 23)) return json({ error: "Withdrawal hours must be whole numbers from 0 to 23." }, 400);
      if ((key === "minWithdrawalEtb" || key === "minRechargeEtb") && value <= 0) return json({ error: "Minimum deposit and withdrawal amounts must be positive." }, 400);
      if (key === "withdrawalFeePercent" && value >= 100) return json({ error: "Withdrawal fee must be below 100%." }, 400);
      if (key.endsWith("CommissionPercent") && value > 100) return json({ error: "Commission percentages must be at most 100%." }, 400);
      if ((key === "registrationBonusEtb" || key === "dailyCheckInEtb") && value > 100000) return json({ error: "Reward amounts exceed the allowed limit." }, 400);
      row[column] = value;
    }
    if (body.commissionBase !== undefined) {
      if (body.commissionBase !== "none" && body.commissionBase !== "verified_deposit") {
        return json({ error: "Choose a supported commission basis." }, 400);
      }
      if (body.commissionBase === "verified_deposit" && !TEAM_COMMISSION_RELEASED) {
        return json({ error: "Team commission is not released yet." }, 503);
      }
      row.commission_base = body.commissionBase;
    }
    if (["level1CommissionPercent", "level2CommissionPercent", "level3CommissionPercent"].some((key) => body[key] !== undefined)) {
      const current = await getPaymentSettings();
      const rates = [
        Number(body.level1CommissionPercent ?? current.level1CommissionPercent),
        Number(body.level2CommissionPercent ?? current.level2CommissionPercent),
        Number(body.level3CommissionPercent ?? current.level3CommissionPercent)
      ];
      if (rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100) ||
          rates.reduce((total, rate) => total + rate, 0) > 100) {
        return json({ error: "The combined three-level commission rate cannot exceed 100% of a verified deposit." }, 400);
      }
    }
    if (body.enforceWithdrawalHours !== undefined) {
      if (typeof body.enforceWithdrawalHours !== "boolean") return json({ error: "Invalid withdrawal schedule setting." }, 400);
      row.enforce_withdrawal_hours = body.enforceWithdrawalHours;
    }
    if (body.withdrawalScheduleNote !== undefined) {
      if (typeof body.withdrawalScheduleNote !== "string" || body.withdrawalScheduleNote.length > 250) return json({ error: "Withdrawal schedule note is too long." }, 400);
      row.withdrawal_schedule_note = body.withdrawalScheduleNote.trim();
    }
    const { error } = await db.from("payment_settings").upsert(row, { onConflict: "id" });
    if (error) throw error;
    await db.from("audit_logs").insert({
      id: "aud-" + crypto.randomUUID().slice(0, 12), actor: adminUsername(),
      action: "Bank payment settings updated", target: "payment_settings",
      details: "Updated bank deposit/withdrawal methods and limits; reward and commission settings unchanged"
    });
    return json(await getPaymentSettings());
  }

  if (method === "GET" && route === "/admin/audit-logs") {
    const { data, error } = await db.from("audit_logs").select("id,actor,action,target,details,created_at").order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    return json({ auditLogs: (data || []).map((a) => ({
      id: a.id, actor: a.actor, action: a.action, target: a.target, details: a.details, timestamp: a.created_at
    })) });
  }

  // Plan purchase/claim endpoints are guarded by a server-side feature switch.
  // They remain unavailable until the plan lifecycle has passed staging tests and is explicitly enabled.
  const isPlanAction =
    (method === "POST" && (route === "/plans/buy" || route === "/welfare/buy")) ||
    (method === "POST" && new RegExp("^/plans/[^/]+/claim$").test(route)) ||
    (method === "POST" && new RegExp("^/welfare/[^/]+/(claim|release)$").test(route));

  if (isPlanAction) {
    if (!PLAN_ACTIONS_RELEASED || !isAllowedPreviewRequest(req)) {
      return json({ error: "Plan purchases and claims are available only in the release Preview." }, 503);
    }

    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    if (auth.role !== "customer") return json({ error: "Customer account required." }, 403);

    if (method === "POST" && route === "/plans/buy") {
      const body = await req.json().catch(() => ({}));
      const planId = typeof body.planId === "string" ? body.planId.trim() : "";
      const plan = VIP_PLANS.find((item) => item.id === planId);
      if (!plan) return json({ error: "Choose a valid Daily VIP plan." }, 400);
      const id = "vip-" + crypto.randomUUID().slice(0, 12);
      const { data, error } = await db.rpc("zentro_buy_vip_plan", {
        p_user_id: auth.userId, p_id: id, p_plan_id: plan.id, p_tier: plan.tier,
        p_investment: plan.investmentEtb, p_daily_income: plan.dailyIncomeEtb,
        p_cycle_days: plan.cycleDays
      });
      if (error) throw error;
      if (!data?.ok) return json({ error: data?.error || "Plan purchase could not be completed." }, 400);
      return json(data, 201);
    }

    const vipClaimMatch = route.match(new RegExp("^/plans/([^/]+)/claim$"));
    if (method === "POST" && vipClaimMatch) {
      const planId = decodeURIComponent(vipClaimMatch[1]);
      const { data, error } = await db.rpc("zentro_claim_vip_daily", {
        p_user_id: auth.userId, p_plan_id: planId
      });
      if (error) throw error;
      if (!data?.ok) return json({ error: data?.error || "Daily claim could not be completed.", ...data }, 400);
      return json(data);
    }

    if (method === "POST" && route === "/welfare/buy") {
      const body = await req.json().catch(() => ({}));
      const planId = typeof body.planId === "string" ? body.planId.trim() : "";
      const plan = WELFARE_PLANS.find((item) => item.id === planId);
      if (!plan) return json({ error: "Choose a valid Welfare plan." }, 400);
      const id = "wel-" + crypto.randomUUID().slice(0, 12);
      const { data, error } = await db.rpc("zentro_buy_welfare_plan", {
        p_user_id: auth.userId, p_id: id, p_plan_id: plan.id, p_plan_name: plan.name,
        p_investment: plan.investmentEtb, p_daily_amount: plan.dailyAmountEtb,
        p_duration_days: plan.durationDays
      });
      if (error) throw error;
      if (!data?.ok) return json({ error: data?.error || "Welfare plan purchase could not be completed." }, 400);
      return json(data, 201);
    }

    const welfareClaimMatch = route.match(new RegExp("^/welfare/([^/]+)/claim$"));
    if (method === "POST" && welfareClaimMatch) {
      const enrollmentId = decodeURIComponent(welfareClaimMatch[1]);
      const { data, error } = await db.rpc("zentro_claim_welfare_daily", {
        p_user_id: auth.userId, p_enrollment_id: enrollmentId
      });
      if (error) throw error;
      if (!data?.ok) return json({ error: data?.error || "Welfare claim could not be completed.", ...data }, 400);
      return json(data);
    }

    const welfareReleaseMatch = route.match(new RegExp("^/welfare/([^/]+)/release$"));
    if (method === "POST" && welfareReleaseMatch) {
      const enrollmentId = decodeURIComponent(welfareReleaseMatch[1]);
      const { data, error } = await db.rpc("zentro_release_welfare_vault", {
        p_user_id: auth.userId, p_enrollment_id: enrollmentId
      });
      if (error) throw error;
      if (!data?.ok) return json({ error: data?.error || "Welfare release could not be completed.", ...data }, 400);
      return json(data);
    }
  }

  if (method === "POST" && route === "/me/check-in") {
    if (!REWARD_CLAIMS_RELEASED || !isAllowedPreviewRequest(req)) return json({ error: "Daily check-in is available only in the release Preview." }, 503);
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    if (auth.role !== "customer") return json({ error: "Customer account required." }, 403);
    const settings = await getPaymentSettings();
    if (settings.dailyCheckInEtb <= 0) return json({ error: "Daily check-in reward is not enabled." }, 503);
    const { data, error } = await db.rpc("zentro_claim_daily_checkin", {
      p_user_id: auth.userId, p_reward: settings.dailyCheckInEtb
    });
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }

  if (method === "POST" && route === "/gift-code") {
    if (!GIFT_CODE_REDEMPTION_RELEASED || !isAllowedPreviewRequest(req)) return json({ error: "Gift code redemption is available only in the release Preview." }, 503);
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    if (auth.role !== "customer") return json({ error: "Customer account required." }, 403);
    const body = await req.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!/^[A-Z0-9-]{4,40}$/.test(code)) return json({ error: "Enter a valid gift code." }, 400);
    const { data, error } = await db.rpc("zentro_redeem_gift_code", {
      p_user_id: auth.userId, p_code: code
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ...data, message: "Gift code successfully redeemed." });
  }

  const uploadMatch = route.match(/^\/uploads\/([^/]+)$/);
  if (method === "GET" && uploadMatch) {
    const auth = await getAuth(req);
    if (!auth) return json({ error: "Authentication required." }, 401);
    const filename = decodeURIComponent(uploadMatch[1]);
    if (!/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(filename)) return json({ error: "File not found." }, 404);
    let bucket = "zentro-broadcasts";
    let visibleQuery = db.from("broadcast_messages").select("id").eq("image_filename", filename);
    if (auth.role !== "admin") visibleQuery = visibleQuery.or("target_user_id.is.null,target_user_id.eq." + auth.userId);
    const { data: visibleBroadcast, error: visibilityError } = await visibleQuery.limit(1).maybeSingle();
    if (visibilityError) throw visibilityError;
    if (!visibleBroadcast) {
      let depositQuery = db.from("deposit_requests").select("id,user_id").eq("receipt_filename", filename);
      if (auth.role !== "admin") depositQuery = depositQuery.eq("user_id", auth.userId);
      const { data: visibleDeposit, error: depositVisibilityError } = await depositQuery.limit(1).maybeSingle();
      if (depositVisibilityError) throw depositVisibilityError;
      if (!visibleDeposit) return json({ error: "File not found." }, 404);
      bucket = "zentro-deposits";
    }
    const { data: file, error: downloadError } = await db.storage.from(bucket).download(filename);
    if (downloadError || !file) return json({ error: "File not found." }, 404);
    const mime = file.type && ["image/jpeg","image/png","image/webp"].includes(file.type) ? file.type : "application/octet-stream";
    return new Response(file, {
      status: 200,
      headers: {
        "content-type": mime,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline; filename=\"" + filename + "\""
      }
    });
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