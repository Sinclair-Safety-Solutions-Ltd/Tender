import { clearMobileSession, getCachedMobileSession, loadMobileSession } from '../auth/session';
import { clearBiometricLogin, loadBiometricMeta, readBiometricVault } from '../auth/biometricStore';
import { clearStepUp } from '../auth/stepUp';
import { mobileApiBaseUrl } from './config';
import { refreshWithRefreshToken } from './sessionRefresh';

export const MOBILE_PAYMENT_RETURN = 'tradetender://payment/return';

export function paymentReturnHeaders(): Record<string, string> {
  return { 'X-Mobile-Payment-Return': MOBILE_PAYMENT_RETURN };
}

export async function readErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return typeof body?.error === 'string' && body.error.trim() ? body.error : fallback;
}

export async function publicApiFetch(path: string, init: RequestInit = {}) {
  return fetch(`${mobileApiBaseUrl()}${path}`, init);
}

let refreshInFlight: Promise<boolean> | null = null;

async function restoreSessionFromBiometricVault() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const vault = await readBiometricVault();
      if (!vault) return false;
      await refreshWithRefreshToken(vault.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function mobileApiFetch(path: string, init: RequestInit = {}, allowRefresh = true) {
  const session = getCachedMobileSession() ?? await loadMobileSession();
  if (!session) throw new Error('Sign in is required.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  const response = await fetch(`${mobileApiBaseUrl()}${path}`, { ...init, headers });
  if (response.status === 401 && allowRefresh && (await loadBiometricMeta())?.enabled) {
    const restored = await restoreSessionFromBiometricVault();
    if (restored) return mobileApiFetch(path, init, false);
    await clearMobileSession();
    throw new Error('Your session has expired. Sign in again.');
  }
  if (response.status === 401) {
    await clearMobileSession();
    throw new Error('Your session has expired. Sign in again.');
  }
  return response;
}

export async function revokeMobileSession() {
  const meta = await loadBiometricMeta();
  try {
    await mobileApiFetch('/api/mobile/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: meta?.deviceId }),
    }, false);
  } catch {
    try {
      const vault = await readBiometricVault();
      if (vault) {
        await fetch(`${mobileApiBaseUrl()}/api/mobile/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: vault.refreshToken }),
        });
      }
    } catch {
      // Local credentials are still removed below.
    }
  } finally {
    clearStepUp();
    await clearMobileSession();
    await clearBiometricLogin();
  }
}
