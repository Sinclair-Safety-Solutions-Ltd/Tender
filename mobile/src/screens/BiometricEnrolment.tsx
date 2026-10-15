import { useEffect, useState } from 'react';
import { Body, Notice, PrimaryButton, SecondaryButton, Title } from '../ui';
import {
  BIOMETRIC_ENROLMENT_COPY,
  BIOMETRIC_PRIVACY_COPY,
  biometricMethodLabel,
  inspectBiometricAvailability,
  promptDeviceAuthentication,
} from '../auth/biometrics';
import { enableBiometricLogin, loadMobileAuthPolicy, type MobileAuthPolicy } from '../api/auth';

export function BiometricEnrolment({
  email,
  onEnabled,
  onSkip,
}: {
  email: string;
  onEnabled: () => void;
  onSkip: () => void;
}) {
  const [policy, setPolicy] = useState<MobileAuthPolicy | null>(null);
  const [method, setMethod] = useState('Device authentication');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadMobileAuthPolicy(), inspectBiometricAvailability()]).then(([nextPolicy, availability]) => {
      if (cancelled) return;
      setPolicy(nextPolicy);
      setMethod(biometricMethodLabel(availability.types));
      const nextEligible = nextPolicy.biometricLoginPolicy !== 'disabled' && availability.canProtectSecrets;
      setEligible(nextEligible);
      if (!nextEligible) onSkip();
    }).catch(() => {
      if (!cancelled) onSkip();
    });
    return () => {
      cancelled = true;
    };
  }, [onSkip]);

  if (!eligible) return null;

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const prompt = await promptDeviceAuthentication(`Enable ${method} for Trade Tender`, {
        disableDeviceFallback: policy?.deviceCredentialFallback === false,
      });
      if (prompt.status !== 'success') {
        setMessage(prompt.message);
        return;
      }
      await enableBiometricLogin(email);
      onEnabled();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to enable biometric login.');
    } finally {
      setBusy(false);
    }
  }

  const heading = policy?.biometricLoginPolicy === 'required'
    ? `${method} is required on eligible devices`
    : policy?.biometricLoginPolicy === 'recommended'
      ? `${method} is recommended`
      : `Use ${method} on this device?`;

  return (
    <>
      <Title>{heading}</Title>
      <Body>{BIOMETRIC_ENROLMENT_COPY}</Body>
      <Body>{BIOMETRIC_PRIVACY_COPY}</Body>
      <Notice>{message}</Notice>
      <PrimaryButton label={`Enable ${method}`} loading={busy} onPress={() => { void enable(); }} />
      {policy?.biometricLoginPolicy !== 'required' ? <SecondaryButton label="Not now" onPress={onSkip} /> : null}
    </>
  );
}
