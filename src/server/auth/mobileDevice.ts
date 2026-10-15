import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/server/data/prisma';
import { recordAuditEvent } from '@/server/audit/auditLog';
import { issueMobileToken } from '@/server/auth/mobileToken';
import { getMobileAuthPolicy } from '@/server/auth/mobileAuthPolicy';
import { ForbiddenError, UnauthorizedError, ValidationError } from '@/server/auth/session';
import { isSignInActive } from '@/server/domain/platformSettings';
import { signInAllowed } from '@/server/auth/signInAccess';

const DEVICE_USER_SELECT = {
  id: true,
  email: true,
  role: true,
  suspended: true,
  emailVerifiedAt: true,
  sessionVersion: true,
  mustChangePassword: true,
  isOwner: true,
  loginLockedUntil: true,
  roleMemberships: { select: { role: true } },
} as const;

export type MobileSessionResponse = {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  deviceId?: string;
  mustChangePassword: boolean;
  user: { email: string; role: 'USER'; roles: string[] };
};

export function hashMobileRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function mobileDeviceWithinMaxAge(createdAt: Date, deviceMaxAgeDays: number, now = new Date()) {
  return now.getTime() - createdAt.getTime() < deviceMaxAgeDays * MS_PER_DAY;
}

function createRefreshToken() {
  return randomBytes(32).toString('base64url');
}

function parsePlatform(value: unknown): 'ios' | 'android' {
  if (value === 'ios' || value === 'android') return value;
  throw new ValidationError('Device platform is required.');
}

async function loadMobileUser(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: DEVICE_USER_SELECT });
}

async function assertMobileUserEligible(user: NonNullable<Awaited<ReturnType<typeof loadMobileUser>>>) {
  if (user.suspended || !user.emailVerifiedAt) throw new UnauthorizedError();
  if (user.role !== 'USER') throw new ForbiddenError();
  if (user.loginLockedUntil && user.loginLockedUntil > new Date()) throw new UnauthorizedError();
  if (!signInAllowed(user, await isSignInActive())) throw new ForbiddenError('LOGIN_DISABLED');
}

async function issueAccessSession(user: NonNullable<Awaited<ReturnType<typeof loadMobileUser>>>, extras?: { refreshToken: string; deviceId: string }): Promise<MobileSessionResponse> {
  const policy = await getMobileAuthPolicy();
  const accessToken = await issueMobileToken({ userId: user.id, role: 'USER', authVersion: user.sessionVersion }, policy.accessTokenLifetimeSeconds);
  return {
    accessToken,
    expiresIn: policy.accessTokenLifetimeSeconds,
    ...(extras ?? {}),
    mustChangePassword: Boolean(user.mustChangePassword),
    user: { email: user.email, role: 'USER', roles: user.roleMemberships.length > 0 ? user.roleMemberships.map((membership) => membership.role) : [user.role] },
  };
}

export async function registerBiometricDevice(userId: string, platformValue: unknown) {
  const policy = await getMobileAuthPolicy();
  if (policy.biometricLoginPolicy === 'disabled') throw new ForbiddenError();
  const platform = parsePlatform(platformValue);
  const user = await loadMobileUser(userId);
  if (!user) throw new UnauthorizedError();
  await assertMobileUserEligible(user);

  const refreshToken = createRefreshToken();
  const now = new Date();
  const slidingExpiry = new Date(now.getTime() + policy.refreshTokenLifetimeSeconds * 1000);
  const maxAgeExpiry = new Date(now.getTime() + policy.deviceMaxAgeDays * MS_PER_DAY);
  const expiresAt = slidingExpiry < maxAgeExpiry ? slidingExpiry : maxAgeExpiry;
  const device = await prisma.mobileDevice.create({
    data: {
      userId: user.id,
      platform,
      refreshTokenHash: hashMobileRefreshToken(refreshToken),
      authVersion: user.sessionVersion,
      biometricEnabled: true,
      lastUsedAt: now,
      expiresAt,
    },
  });
  await recordAuditEvent({
    actorId: user.id,
    action: 'MOBILE_DEVICE_REGISTERED',
    targetType: 'MobileDevice',
    targetId: device.id,
    metadata: { channel: 'mobile', platform },
  });
  await recordAuditEvent({
    actorId: user.id,
    action: 'MOBILE_BIOMETRIC_ENABLED',
    targetType: 'MobileDevice',
    targetId: device.id,
    metadata: { channel: 'mobile', platform },
  });
  return { deviceId: device.id, refreshToken, expiresAt: device.expiresAt.toISOString() };
}

export async function refreshMobileDeviceSession(refreshToken: string) {
  if (!refreshToken) throw new UnauthorizedError();
  const device = await prisma.mobileDevice.findUnique({
    where: { refreshTokenHash: hashMobileRefreshToken(refreshToken) },
    include: { user: { select: DEVICE_USER_SELECT } },
  });
  if (!device) {
    await recordAuditEvent({
      actorId: null,
      action: 'MOBILE_TOKEN_REFRESH_REJECTED',
      targetType: 'MobileDevice',
      targetId: 'unknown',
      metadata: { channel: 'mobile', reason: 'invalid' },
    });
    throw new UnauthorizedError();
  }

  const reject = async (reason: string) => {
    await recordAuditEvent({
      actorId: device.userId,
      action: 'MOBILE_TOKEN_REFRESH_REJECTED',
      targetType: 'MobileDevice',
      targetId: device.id,
      metadata: { channel: 'mobile', reason },
    });
    throw new UnauthorizedError();
  };

  if (device.revokedAt || !device.biometricEnabled) await reject('revoked');
  if (device.expiresAt <= new Date()) await reject('expired');
  const policy = await getMobileAuthPolicy();
  if (!mobileDeviceWithinMaxAge(device.createdAt, policy.deviceMaxAgeDays)) await reject('max-age');
  if (policy.biometricLoginPolicy === 'disabled') await reject('policy');
  try {
    await assertMobileUserEligible(device.user);
  } catch (error) {
    if (error instanceof ForbiddenError && error.message === 'LOGIN_DISABLED') throw error;
    await reject(error instanceof ForbiddenError ? 'role' : 'account');
  }
  if (device.authVersion !== device.user.sessionVersion) await reject('session');

  const nextRefreshToken = createRefreshToken();
  const slidingExpiry = new Date(Date.now() + policy.refreshTokenLifetimeSeconds * 1000);
  const maxAgeExpiry = new Date(device.createdAt.getTime() + policy.deviceMaxAgeDays * MS_PER_DAY);
  const expiresAt = slidingExpiry < maxAgeExpiry ? slidingExpiry : maxAgeExpiry;
  const rotated = await prisma.mobileDevice.updateMany({
    where: { id: device.id, refreshTokenHash: device.refreshTokenHash, revokedAt: null },
    data: {
      refreshTokenHash: hashMobileRefreshToken(nextRefreshToken),
      lastUsedAt: new Date(),
      expiresAt,
    },
  });
  if (rotated.count !== 1) await reject('revoked');

  await recordAuditEvent({
    actorId: device.userId,
    action: 'MOBILE_BIOMETRIC_LOGIN_SUCCEEDED',
    targetType: 'MobileDevice',
    targetId: device.id,
    metadata: { channel: 'mobile', platform: device.platform },
  });
  return issueAccessSession(device.user, { refreshToken: nextRefreshToken, deviceId: device.id });
}

export async function revokeMobileDevice(input: { actorId?: string; deviceId?: string; refreshToken?: string; reason?: 'logout' | 'disabled' | 'replaced' }) {
  if (input.reason === 'disabled' && (await getMobileAuthPolicy()).biometricLoginPolicy === 'required') {
    throw new ForbiddenError();
  }
  const device = input.refreshToken
    ? await prisma.mobileDevice.findUnique({ where: { refreshTokenHash: hashMobileRefreshToken(input.refreshToken) } })
    : input.deviceId && input.actorId
      ? await prisma.mobileDevice.findFirst({ where: { id: input.deviceId, userId: input.actorId } })
      : null;
  if (!device || device.revokedAt) return null;
  if (input.actorId && device.userId !== input.actorId) throw new ForbiddenError();

  await prisma.mobileDevice.updateMany({
    where: { id: device.id, revokedAt: null },
    data: { revokedAt: new Date(), biometricEnabled: false, refreshTokenHash: hashMobileRefreshToken(`revoked:${device.id}:${randomBytes(16).toString('hex')}`) },
  });
  await recordAuditEvent({
    actorId: input.actorId ?? device.userId,
    action: 'MOBILE_DEVICE_REVOKED',
    targetType: 'MobileDevice',
    targetId: device.id,
    metadata: { channel: 'mobile', reason: input.reason ?? 'disabled' },
  });
  await recordAuditEvent({
    actorId: input.actorId ?? device.userId,
    action: 'MOBILE_BIOMETRIC_DISABLED',
    targetType: 'MobileDevice',
    targetId: device.id,
    metadata: { channel: 'mobile', reason: input.reason ?? 'disabled' },
  });
  return device.id;
}

export async function listMobileDevices(userId: string) {
  const policy = await getMobileAuthPolicy();
  const now = new Date();
  const devices = await prisma.mobileDevice.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      platform: true,
      biometricEnabled: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  return devices.map((device) => ({
    id: device.id,
    platform: device.platform,
    biometricEnabled:
      device.biometricEnabled
      && !device.revokedAt
      && device.expiresAt > now
      && mobileDeviceWithinMaxAge(device.createdAt, policy.deviceMaxAgeDays, now),
    createdAt: device.createdAt.toISOString(),
    lastUsedAt: device.lastUsedAt?.toISOString() ?? null,
    revokedAt: device.revokedAt?.toISOString() ?? null,
    expiresAt: device.expiresAt.toISOString(),
  }));
}

export const MOBILE_SECURITY_EVENT_ACTIONS = [
  'BIOMETRIC_LOGIN_ATTEMPTED',
  'BIOMETRIC_LOGIN_FAILED',
  'BIOMETRIC_LOGIN_CANCELLED',
  'BIOMETRIC_LOCKOUT',
  'BIOMETRIC_CREDENTIAL_UNAVAILABLE',
  'STEP_UP_REQUESTED',
  'STEP_UP_SUCCEEDED',
  'STEP_UP_FAILED',
  'FULL_REAUTHENTICATION_REQUIRED',
] as const;

export type MobileSecurityEventAction = (typeof MOBILE_SECURITY_EVENT_ACTIONS)[number];

export async function recordMobileSecurityEvent(input: { actorId?: string; deviceId?: string; action: MobileSecurityEventAction }) {
  const targetId = input.deviceId && /^[a-z0-9]{20,32}$/i.test(input.deviceId) ? input.deviceId : 'unknown';
  await recordAuditEvent({
    actorId: input.actorId ?? null,
    action: `MOBILE_${input.action}`,
    targetType: 'MobileDevice',
    targetId,
    metadata: { channel: 'mobile' },
  });
}
