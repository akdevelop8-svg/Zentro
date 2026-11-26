import crypto from 'node:crypto';

export interface AuthTokenPayload {
  userId: string;
  role: 'customer' | 'admin';
  name: string;
  exp: number;
}

let runtimeSessionSecret: string | null = null;
let externalSecretProvider: (() => string) | null = null;

export function registerSessionSecretProvider(provider: () => string): void {
  externalSecretProvider = provider;
}

function getSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  if (!runtimeSessionSecret) {
    runtimeSessionSecret = externalSecretProvider
      ? externalSecretProvider()
      : crypto.randomBytes(32).toString('hex');
  }
  return runtimeSessionSecret;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function verifyPlaintextConstantTime(input: string, expected: string): boolean {
  const inputDigest = crypto.createHash('sha256').update(input, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(inputDigest, expectedDigest);
}

export function issueToken(payload: Omit<AuthTokenPayload, 'exp'>): string {
  const fullPayload: AuthTokenPayload = {
    ...payload,
    exp: Date.now() + 30 * 24 * 3600 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyToken(token: string): AuthTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as AuthTokenPayload;
    if (
      !parsed ||
      typeof parsed.userId !== 'string' ||
      (parsed.role !== 'customer' && parsed.role !== 'admin') ||
      typeof parsed.exp !== 'number' ||
      parsed.exp < Date.now()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getAdminUsername(): string {
  return (process.env.ADMIN_USERNAME || 'Zentro').trim();
}

export function getEnvAdminPassword(): string {
  return (process.env.ADMIN_PASSWORD || '').trim();
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
