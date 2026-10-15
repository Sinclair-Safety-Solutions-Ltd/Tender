import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Face ID and local authentication are declared without camera permission', () => {
  const app = JSON.parse(readFileSync('app.json', 'utf8')) as {
    expo: {
      ios: { infoPlist: Record<string, string> };
      android: { permissions: string[] };
      plugins: Array<string | [string, Record<string, unknown>]>;
    };
  };
  const pluginNames = app.expo.plugins.map((plugin) => typeof plugin === 'string' ? plugin : plugin[0]);
  assert.equal(pluginNames.includes('expo-local-authentication'), true);
  assert.match(app.expo.ios.infoPlist.NSFaceIDUsageDescription, /does not receive, store, or process/);
  assert.equal(app.expo.android.permissions.includes('CAMERA'), false);
  assert.equal(app.expo.android.permissions.includes('android.permission.CAMERA'), false);
});

test('biometric login extends SecureStore and never stores a password', () => {
  const session = readFileSync('src/auth/session.ts', 'utf8');
  const store = readFileSync('src/auth/biometricStore.ts', 'utf8');
  const auth = readFileSync('src/api/auth.ts', 'utf8');
  const client = readFileSync('src/api/client.ts', 'utf8');
  const biometrics = readFileSync('src/auth/biometrics.ts', 'utf8');

  assert.match(store, /requireAuthentication: true/);
  assert.match(store, /WHEN_PASSCODE_SET_THIS_DEVICE_ONLY/);
  assert.match(session, /persistAccessToken/);
  assert.match(auth, /enableBiometricLogin/);
  assert.match(auth, /disableBiometricLogin/);
  assert.match(client, /clearBiometricLogin/);
  assert.match(client, /\/api\/mobile\/auth\/logout/);
  assert.match(biometrics, /does not collect, store or process your fingerprint/);
  assert.match(store, /refreshToken: string/);
  assert.match(store, /deviceId: string/);
  assert.doesNotMatch(store, /passwordHash|currentPassword/);
  assert.doesNotMatch(session, /passwordHash|currentPassword/);
});

test('required policy cannot skip enrolment or turn biometric login off on this device', () => {
  const enrolment = readFileSync('src/screens/BiometricEnrolment.tsx', 'utf8');
  const settings = readFileSync('src/screens/BiometricSettings.tsx', 'utf8');
  const auth = readFileSync('src/api/auth.ts', 'utf8');
  const client = readFileSync('src/api/client.ts', 'utf8');
  const logout = client.slice(client.indexOf('export async function revokeMobileSession'));
  assert.match(enrolment, /biometricLoginPolicy !== 'required'/);
  assert.match(settings, /requiredEnabled/);
  assert.match(auth, /Unable to turn off biometric login/);
  assert.match(logout, /\/api\/mobile\/auth\/logout/);
  assert.doesNotMatch(logout, /devices\/revoke/);
});

test('enrolment and settings copy stay optional and device-specific', () => {
  const enrolment = readFileSync('src/screens/BiometricEnrolment.tsx', 'utf8');
  const copy = readFileSync('src/auth/biometrics.ts', 'utf8');
  const settings = readFileSync('src/screens/BiometricSettings.tsx', 'utf8');
  const lock = readFileSync('src/screens/BiometricLock.tsx', 'utf8');
  const app = readFileSync('App.tsx', 'utf8');
  const profile = readFileSync('src/screens/AccountScreens.tsx', 'utf8');

  assert.match(enrolment, /Not now/);
  assert.match(copy, /Email and password sign-in stays available/);
  assert.match(settings, /Biometric Login/);
  assert.match(settings, /This setting applies only to this device/);
  assert.match(lock, /Sign in with email and password/);
  assert.match(app, /BiometricLock/);
  assert.match(app, /BiometricEnrolment/);
  assert.match(app, /ForcedPasswordChange/);
  assert.match(profile, /BiometricSettings/);
  assert.match(profile, /requireMobileStepUp\('password-change'/);
});

test('step-up covers unlock, contact release, and biometric settings', () => {
  const tender = readFileSync('src/screens/TenderScreen.tsx', 'utf8');
  const stepUp = readFileSync('src/auth/stepUp.ts', 'utf8');
  const app = readFileSync('App.tsx', 'utf8');
  const auth = readFileSync('src/api/auth.ts', 'utf8');
  const client = readFileSync('src/api/client.ts', 'utf8');
  assert.match(tender, /tender-unlock/);
  assert.match(tender, /quote-accept/);
  assert.match(tender, /contact-release/);
  assert.match(tender, /direct-contact/);
  assert.match(tender, /professional-interest/);
  assert.match(stepUp, /stepUpValiditySeconds/);
  assert.match(stepUp, /STEP_UP_REQUESTED/);
  assert.match(stepUp, /export function clearStepUp/);
  assert.match(auth, /clearStepUp\(\)/);
  assert.match(client, /clearStepUp\(\)/);
  assert.match(app, /clearStepUp\(\)/);
  assert.match(app, /setBiometricUnlock\(true\)/);
});

test('refresh stores the rotated refresh token before the new access session', () => {
  const refresh = readFileSync('src/api/sessionRefresh.ts', 'utf8');
  const body = refresh.slice(refresh.indexOf('export async function refreshWithRefreshToken'));
  const vaultWrite = body.indexOf('replaceBiometricRefreshToken');
  const sessionSave = body.indexOf('saveMobileSession');
  assert.notEqual(vaultWrite, -1);
  assert.notEqual(sessionSave, -1);
  assert.ok(vaultWrite < sessionSave);
  assert.match(body, /\/api\/mobile\/auth\/devices\/revoke/);
  assert.match(body, /clearBiometricLogin/);
  assert.match(body, /clearMobileSession/);
});
