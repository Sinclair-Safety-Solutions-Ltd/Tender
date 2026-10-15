import { useEffect, useState } from 'react';
import { Switch } from 'react-native';
import { Body, Card, Label, Notice, Title } from '../ui';
import {
  BIOMETRIC_PRIVACY_COPY,
  biometricMethodLabel,
  inspectBiometricAvailability,
  promptDeviceAuthentication,
  settingStatusLabel,
} from '../auth/biometrics';
import { loadBiometricMeta } from '../auth/biometricStore';
import { disableBiometricLogin, enableBiometricLogin, loadMobileAuthPolicy, type MobileAuthPolicy } from '../api/auth';
import { requireMobileStepUp } from '../auth/stepUp';
import { colors } from '../theme';

export function BiometricSettings({ email }: { email: string }) {
  const [policy, setPolicy] = useState<MobileAuthPolicy | null>(null);
  const [method, setMethod] = useState('Biometric Login');
  const [status, setStatus] = useState<'available' | 'unavailable' | 'enabled' | 'disabled' | 'locked' | 'reenrol'>('unavailable');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [nextPolicy, availability, meta] = await Promise.all([
      loadMobileAuthPolicy(),
      inspectBiometricAvailability(),
      loadBiometricMeta(),
    ]);
    setPolicy(nextPolicy);
    setMethod(biometricMethodLabel(availability.types));
    if (nextPolicy.biometricLoginPolicy === 'disabled' || !availability.hardware) {
      setStatus('unavailable');
      return;
    }
    if (!availability.enrolled) {
      setStatus(meta?.enabled ? 'reenrol' : 'unavailable');
      return;
    }
    if (meta?.enabled) setStatus('enabled');
    else setStatus('disabled');
  }

  useEffect(() => {
    void refresh().catch(() => setStatus('unavailable'));
  }, []);

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await requireMobileStepUp('biometric-setting', `Confirm it is you before changing ${method}.`, policy);
      if (next) {
        const prompt = await promptDeviceAuthentication(`Enable ${method} for Trade Tender`, {
          disableDeviceFallback: policy?.deviceCredentialFallback === false,
        });
        if (prompt.status !== 'success') {
          if (prompt.status === 'lockout') setStatus('locked');
          setMessage(prompt.message);
          return;
        }
        await enableBiometricLogin(email);
      } else {
        await disableBiometricLogin();
      }
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to update biometric login.');
    } finally {
      setBusy(false);
    }
  }

  const enabled = status === 'enabled';
  const requiredEnabled = policy?.biometricLoginPolicy === 'required' && enabled;
  const toggleDisabled = busy || status === 'unavailable' || status === 'locked' || policy?.biometricLoginPolicy === 'disabled' || requiredEnabled;

  return (
    <Card>
      <Title>{method}</Title>
      <Label>Biometric Login</Label>
      <Body>Status: {settingStatusLabel(status)}</Body>
      <Body>{BIOMETRIC_PRIVACY_COPY}</Body>
      <Body>This setting applies only to this device. Email and password remain available.</Body>
      <Switch
        accessibilityLabel={`Biometric Login, ${settingStatusLabel(status)}`}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled, disabled: toggleDisabled }}
        disabled={toggleDisabled}
        onValueChange={(value) => { void toggle(value); }}
        thumbColor={colors.siteWhite}
        trackColor={{ false: colors.border, true: colors.tradeBlue }}
        value={enabled}
      />
      <Notice>{message}</Notice>
    </Card>
  );
}
