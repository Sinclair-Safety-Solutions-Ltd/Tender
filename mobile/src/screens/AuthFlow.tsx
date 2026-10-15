import { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { signInWithPassword, requestPasswordReset, resetPasswordWithToken } from '../api/auth';
import { inspectBiometricAvailability, biometricMethodLabel } from '../auth/biometrics';
import { loadBiometricMeta, readBiometricVault } from '../auth/biometricStore';
import { refreshWithRefreshToken } from '../api/sessionRefresh';
import { loadPublishedCatalog, registerMobileAccount, type WorkspaceIntent } from '../api/registration';
import { COMPANY_TYPE_LABELS, COMPANY_TYPES, UK_COUNTIES, UK_REGIONS, type CategoryCatalog, type CompanyType } from '../constants';
import { mobileApiBaseUrl } from '../api/config';
import { Body, Card, Checkbox, ChipSelect, Eyebrow, Field, Notice, OptionList, PrimaryButton, SecondaryButton, Title } from '../ui';
import { colors, fonts } from '../theme';
import type { MobileSession } from '../auth/session';

type AuthScreen = 'signIn' | 'register' | 'forgotPassword';

export function AuthFlow({ onSignedIn }: { onSignedIn: (session: MobileSession) => void }) {
  const [screen, setScreen] = useState<AuthScreen>('signIn');
  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Image alt="Trade Tender" accessibilityLabel="Trade Tender" source={require('../../assets/trade-tender-logo.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <View style={styles.content}>
        <Eyebrow>Native mobile client</Eyebrow>
        <Title>Trade Tender</Title>
        <Body>Set out the job. Compare quotes. Award the work.</Body>
        {screen === 'signIn' && <SignInForm onSignedIn={onSignedIn} onRegister={() => setScreen('register')} onForgot={() => setScreen('forgotPassword')} />}
        {screen === 'register' && <RegisterForm onBack={() => setScreen('signIn')} />}
        {screen === 'forgotPassword' && <ForgotPasswordForm onBack={() => setScreen('signIn')} />}
      </View>
    </ScrollView>
  );
}

function SignInForm({
  onSignedIn,
  onRegister,
  onForgot,
}: {
  onSignedIn: (session: MobileSession) => void;
  onRegister: () => void;
  onForgot: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const meta = await loadBiometricMeta();
      if (!meta?.enabled) return;
      const availability = await inspectBiometricAvailability();
      if (availability.canProtectSecrets) setBiometricLabel(biometricMethodLabel(availability.types));
    })();
  }, []);

  async function handleSignIn() {
    setSubmitting(true);
    setError(null);
    try {
      onSignedIn(await signInWithPassword(email.trim(), password, needsMfa ? mfaCode.trim() : undefined));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to sign in.';
      if (message.includes('authenticator')) setNeedsMfa(true);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBiometric() {
    setSubmitting(true);
    setError(null);
    try {
      const vault = await readBiometricVault();
      if (!vault) throw new Error('Secure credential unavailable. Sign in with email and password.');
      onSignedIn(await refreshWithRefreshToken(vault.refreshToken));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      {biometricLabel ? <PrimaryButton label={`Unlock with ${biometricLabel}`} loading={submitting} onPress={() => { void handleBiometric(); }} /> : null}
      <Field autoCapitalize="none" autoComplete="email" keyboardType="email-address" label="Email" onChangeText={setEmail} value={email} />
      <Field autoComplete="current-password" label="Password" onChangeText={setPassword} secureTextEntry value={password} />
      {needsMfa ? <Field autoCapitalize="none" keyboardType="number-pad" label="Authenticator code" onChangeText={setMfaCode} value={mfaCode} /> : null}
      <Notice>{error}</Notice>
      <PrimaryButton disabled={!email || !password || submitting} label="Sign in" loading={submitting} onPress={handleSignIn} />
      <SecondaryButton label="Create account" onPress={onRegister} />
      <Pressable accessibilityRole="button" onPress={onForgot}><Text style={styles.link}>Forgot password</Text></Pressable>
    </Card>
  );
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRequest() {
    setSubmitting(true);
    setMessage(null);
    try {
      await requestPasswordReset(email.trim());
      setMessage('If an account exists, a reset link has been sent. Paste the token from that email to set a new password here.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to request a password reset.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset() {
    setSubmitting(true);
    setMessage(null);
    try {
      await resetPasswordWithToken(token.trim(), password);
      setMessage('Password updated. You can sign in.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to set a new password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <Body>Request a reset email, then set a new password with the token from that message.</Body>
      <Field autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={setEmail} value={email} />
      <PrimaryButton disabled={!email} label="Send reset email" loading={submitting} onPress={handleRequest} />
      <Field label="Reset token" onChangeText={setToken} value={token} />
      <Field label="New password" onChangeText={setPassword} secureTextEntry value={password} />
      <SecondaryButton disabled={!token || !password} label="Set new password" onPress={handleReset} />
      <Notice>{message}</Notice>
      <SecondaryButton label="Back to sign in" onPress={onBack} />
    </Card>
  );
}

function RegisterForm({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [intent, setIntent] = useState<WorkspaceIntent>('buying');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [branchIdentifier, setBranchIdentifier] = useState('');
  const [companyType, setCompanyType] = useState<CompanyType>('LIMITED_COMPANY');
  const [coverageScope, setCoverageScope] = useState<'COUNTY' | 'REGION' | 'UK'>('COUNTY');
  const [counties, setCounties] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [serviceProvisions, setServiceProvisions] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CategoryCatalog>({});
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadPublishedCatalog().then(setCatalog).catch(() => undefined);
  }, []);

  const supplies = intent !== 'buying';
  const serviceNames = Object.keys(catalog);
  const provisionOptions = useMemo(
    () => services.flatMap((service) => Object.keys(catalog[service] ?? {}).map((provision) => ({ label: `${service} · ${provision}`, value: `${service}::${provision}` }))),
    [catalog, services],
  );

  function validateAccount() {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !companyName.trim() || !branchIdentifier.trim()) {
      setMessage('Complete the required account details.');
      return false;
    }
    if (password.length < 10 || password.length > 200 || !/[A-Z]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setMessage('Password must be 10-200 characters, including a capital letter and a special character.');
      return false;
    }
    return true;
  }

  function validateCoverage() {
    if (!supplies) return true;
    if (services.length === 0) {
      setMessage('Select at least one category you supply.');
      return false;
    }
    if (serviceProvisions.length === 0) {
      setMessage('Select at least one provision for the services you supply.');
      return false;
    }
    if (coverageScope === 'COUNTY' && counties.length === 0) {
      setMessage('Select at least one county, or choose a wider operating area.');
      return false;
    }
    if (coverageScope === 'REGION' && regions.length === 0) {
      setMessage('Select at least one region, or choose UK-wide coverage.');
      return false;
    }
    return true;
  }

  async function handleSubmit() {
    setMessage(null);
    if (!validateAccount() || !validateCoverage()) return;
    if (!termsAccepted || !privacyAccepted) {
      setMessage('Accept the terms and the privacy policy to register.');
      return;
    }
    setSubmitting(true);
    try {
      const status = await registerMobileAccount({
        email: email.trim(),
        password,
        contactName: `${firstName} ${lastName}`.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        contactPhone: contactPhone.trim() || undefined,
        companyName: companyName.trim(),
        companyType,
        branchIdentifier: branchIdentifier.trim(),
        termsAccepted: true,
        privacyAccepted: true,
        categories: supplies ? services : [],
        serviceProvisions: supplies ? serviceProvisions : [],
        coverageScope: supplies ? coverageScope : undefined,
        counties: supplies && coverageScope === 'COUNTY' ? counties : undefined,
        regions: supplies && coverageScope === 'REGION' ? regions : undefined,
      });
      setMessage(status === 'verified' ? 'Account created. You can sign in now.' : status === 'verification_sent' ? 'Check your email to verify the account before signing in.' : 'Account created. Check your email to verify it before signing in.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to create account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <Body>Step {step} of 3</Body>
      {step === 1 && (
        <>
          <Field label="First name" onChangeText={setFirstName} value={firstName} />
          <Field label="Last name" onChangeText={setLastName} value={lastName} />
          <Field autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={setEmail} value={email} />
          <Field keyboardType="phone-pad" label="Phone" onChangeText={setContactPhone} value={contactPhone} />
          <Field label="Company name" onChangeText={setCompanyName} value={companyName} />
          <Field label="Branch" onChangeText={setBranchIdentifier} value={branchIdentifier} />
          <OptionList label="Company type" onChange={(value) => setCompanyType(value as CompanyType)} options={COMPANY_TYPES.map((type) => ({ label: COMPANY_TYPE_LABELS[type], value: type }))} value={companyType} />
          <Field autoComplete="new-password" label="Password" onChangeText={setPassword} secureTextEntry value={password} />
        </>
      )}
      {step === 2 && (
        <>
          <OptionList
            label="Workspace"
            onChange={(value) => setIntent(value as WorkspaceIntent)}
            options={[
              { label: 'Buying', value: 'buying' },
              { label: 'Supplying', value: 'supplying' },
              { label: 'Both', value: 'both' },
            ]}
            value={intent}
          />
          <Body>You can buy and supply from the same account. Supplying uses your company services for matching.</Body>
        </>
      )}
      {step === 3 && supplies && (
        <>
          <ChipSelect label="Services you supply" onChange={setServices} options={serviceNames.map((service) => ({ label: service, value: service }))} selected={services} />
          <ChipSelect label="Provisions" onChange={setServiceProvisions} options={provisionOptions} selected={serviceProvisions} />
          <OptionList
            label="Coverage"
            onChange={(value) => setCoverageScope(value as 'COUNTY' | 'REGION' | 'UK')}
            options={[
              { label: 'Counties', value: 'COUNTY' },
              { label: 'Regions', value: 'REGION' },
              { label: 'UK-wide', value: 'UK' },
            ]}
            value={coverageScope}
          />
          {coverageScope === 'COUNTY' && <ChipSelect label="Counties" onChange={setCounties} options={UK_COUNTIES.map((county) => ({ label: county, value: county }))} selected={counties} />}
          {coverageScope === 'REGION' && <ChipSelect label="Regions" onChange={setRegions} options={UK_REGIONS.map((region) => ({ label: region, value: region }))} selected={regions} />}
        </>
      )}
      {step === 3 && (
        <>
          <Checkbox checked={termsAccepted} label="I accept the platform terms." onToggle={() => setTermsAccepted((value) => !value)} />
          <Checkbox checked={privacyAccepted} label="I acknowledge the privacy policy." onToggle={() => setPrivacyAccepted((value) => !value)} />
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${mobileApiBaseUrl()}/policies`).catch(() => undefined)}>
            <Text style={styles.link}>Read policies</Text>
          </Pressable>
        </>
      )}
      <Notice>{message}</Notice>
      {step < 3 ? (
        <PrimaryButton
          label="Continue"
          onPress={() => {
            setMessage(null);
            if (step === 1 && !validateAccount()) return;
            setStep(step + 1);
          }}
        />
      ) : (
        <PrimaryButton disabled={!termsAccepted || !privacyAccepted} label="Create account" loading={submitting} onPress={handleSubmit} />
      )}
      {step > 1 && <SecondaryButton label="Back" onPress={() => setStep(step - 1)} />}
      <SecondaryButton label="Back to sign in" onPress={onBack} />
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.foundationNavy,
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  logo: {
    height: 92,
    width: 220,
  },
  content: {
    padding: 24,
  },
  link: {
    color: colors.tradeBlue,
    fontFamily: fonts.bodySemi,
    fontSize: 15,
    marginTop: 12,
  },
});
