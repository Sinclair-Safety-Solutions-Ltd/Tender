import { Platform } from 'react-native';
import { loadMobileSession, saveMobileSession, type MobileSession } from '../auth/session';
import { clearBiometricLogin, loadBiometricMeta, saveBiometricVault } from '../auth/biometricStore';
import { clearStepUp } from '../auth/stepUp';
import { mobileApiBaseUrl } from './config';
import { mobileApiFetch, publicApiFetch, readErrorMessage } from './client';

type LoginResponse = {
  accessToken: string;
  expiresIn: number;
  mustChangePassword?: boolean;
  user: { email: string; role: 'SUPER_USER' | 'USER' };
};

export type MobileAuthPolicy = {
  biometricLoginPolicy: 'disabled' | 'optional' | 'recommended' | 'required';
  deviceCredentialFallback: boolean;
  stepUpValiditySeconds: number;
  inactivityTimeoutSeconds: number;
  accessTokenLifetimeSeconds: number;
  stepUpActions: string[];
};

function sessionFromLogin(body: LoginResponse): MobileSession {
  return {
    accessToken: body.accessToken,
    expiresAt: Date.now() + body.expiresIn * 1000,
    email: body.user.email,
    role: body.user.role,
    mustChangePassword: body.mustChangePassword === true,
  };
}

export async function signInWithPassword(email: string, password: string, mfaCode?: string): Promise<MobileSession> {
  const response = await fetch(`${mobileApiBaseUrl()}/api/mobile/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, ...(mfaCode ? { mfaCode } : {}) }),
  });
  const body = await response.json().catch(() => null) as LoginResponse | { error?: string } | null;
  if (!response.ok || !body || !('accessToken' in body) || !('expiresIn' in body) || !('user' in body)) {
    throw new Error(body && 'error' in body && typeof body.error === 'string' ? body.error : 'Unable to sign in.');
  }
  const session = sessionFromLogin(body);
  clearStepUp();
  const meta = await loadBiometricMeta();
  if (meta && meta.email !== session.email) await clearBiometricLogin();
  await saveMobileSession(session, { persistAccessToken: true });
  return session;
}

export async function loadMobileAuthPolicy(): Promise<MobileAuthPolicy> {
  const response = await publicApiFetch('/api/mobile/auth/policy');
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to load sign-in settings.'));
  return response.json() as Promise<MobileAuthPolicy>;
}

export async function enableBiometricLogin(email: string) {
  const response = await mobileApiFetch('/api/mobile/auth/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: Platform.OS === 'ios' ? 'ios' : 'android' }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to enable biometric login.'));
  const body = await response.json() as { deviceId?: string; refreshToken?: string };
  if (typeof body.deviceId !== 'string' || typeof body.refreshToken !== 'string') {
    throw new Error('Unable to enable biometric login.');
  }
  try {
    await saveBiometricVault({ email, deviceId: body.deviceId, refreshToken: body.refreshToken });
  } catch (error) {
    await mobileApiFetch('/api/mobile/auth/devices/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: body.deviceId, refreshToken: body.refreshToken }),
    }).catch(() => undefined);
    throw error;
  }
  const session = await loadMobileSession();
  if (session) await saveMobileSession(session, { persistAccessToken: false });
  return body.deviceId;
}

export async function disableBiometricLogin() {
  const meta = await loadBiometricMeta();
  if (meta) {
    const response = await mobileApiFetch('/api/mobile/auth/devices/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: meta.deviceId }),
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to turn off biometric login.'));
  }
  await clearBiometricLogin();
}

export async function reportMobileSecurityEvent(action: string, deviceId?: string) {
  await fetch(`${mobileApiBaseUrl()}/api/mobile/auth/security-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, deviceId }),
  }).catch(() => undefined);
}

export async function requestPasswordReset(email: string) {
  const response = await fetch(`${mobileApiBaseUrl()}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to request a password reset.'));
}

export async function resetPasswordWithToken(token: string, password: string) {
  const response = await fetch(`${mobileApiBaseUrl()}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Unable to set a new password.'));
}
