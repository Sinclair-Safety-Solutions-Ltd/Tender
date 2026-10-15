import { Montserrat_600SemiBold, Montserrat_700Bold, useFonts as useMontserratFonts } from '@expo-google-fonts/montserrat';
import { SourceSans3_400Regular, SourceSans3_600SemiBold, useFonts as useSourceSansFonts } from '@expo-google-fonts/source-sans-3';
import { StatusBar } from 'expo-status-bar';
import * as ExpoLinking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, AppState } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { loadMobileSession, clearMobileSession, type MobileSession } from './src/auth/session';
import { loadBiometricMeta } from './src/auth/biometricStore';
import { inspectBiometricAvailability } from './src/auth/biometrics';
import { cacheMobileAuthPolicy, clearStepUp, startStepUpLifecycle } from './src/auth/stepUp';
import { loadMobileAuthPolicy, type MobileAuthPolicy } from './src/api/auth';
import { revokeMobileSession } from './src/api/client';
import { loadCapabilities, type BuyerCapabilities } from './src/api/workspace';
import { AuthFlow } from './src/screens/AuthFlow';
import { ForcedPasswordChange } from './src/screens/ForcedPasswordChange';
import { BiometricLock } from './src/screens/BiometricLock';
import { BiometricEnrolment } from './src/screens/BiometricEnrolment';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { AwardedScreen, CreateTenderScreen, TendersScreen } from './src/screens/BuyingScreens';
import { TenderScreen } from './src/screens/TenderScreen';
import { OpportunitiesScreen, SubmittedQuotesScreen, VerificationScreen } from './src/screens/SupplyingScreens';
import { BillingScreen, ProfileScreen, SupportScreen } from './src/screens/AccountScreens';
import { Body, PrimaryButton, Title } from './src/ui';
import { WORKSPACE_TABS, tabForRoute, titleForRoute, type Route } from './src/navigation/types';
import { colors, fonts, tapMinHeight } from './src/theme';

type PendingPayment = { kind: 'unlock' | 'release' | 'direct-contact' | 'professional-interest'; tenderId: string; quoteId?: string; paymentId?: string };

void SplashScreen.preventAutoHideAsync();

export default function App() {
  const [montserratLoaded] = useMontserratFonts({ Montserrat_600SemiBold, Montserrat_700Bold });
  const [sourceSansLoaded] = useSourceSansFonts({ SourceSans3_400Regular, SourceSans3_600SemiBold });
  const [session, setSession] = useState<MobileSession | null>(null);
  const [ready, setReady] = useState(false);
  const [biometricUnlock, setBiometricUnlock] = useState(false);
  const [offerEnrolment, setOfferEnrolment] = useState(false);
  const [policy, setPolicy] = useState<MobileAuthPolicy | null>(null);
  const policyRef = useRef<MobileAuthPolicy | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const appReady = montserratLoaded && sourceSansLoaded && ready;

  useEffect(() => {
    policyRef.current = policy;
  }, [policy]);

  useEffect(() => {
    startStepUpLifecycle(() => policyRef.current);
    void (async () => {
      try {
        const nextPolicy = await loadMobileAuthPolicy();
        setPolicy(nextPolicy);
        cacheMobileAuthPolicy(nextPolicy);
      } catch {
        cacheMobileAuthPolicy(null);
      }
      try {
        if ((await loadBiometricMeta())?.enabled) {
          setBiometricUnlock(true);
          return;
        }
        setSession(await loadMobileSession());
      } catch {
        setSession(null);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') {
        backgroundedAt.current = Date.now();
        return;
      }
      const started = backgroundedAt.current;
      backgroundedAt.current = null;
      const current = policyRef.current;
      if (!current || current.inactivityTimeoutSeconds <= 0 || started == null) return;
      if (Date.now() - started < current.inactivityTimeoutSeconds * 1000) return;
      void (async () => {
        if (!(await loadBiometricMeta())?.enabled) return;
        clearStepUp();
        await clearMobileSession();
        setSession(null);
        setBiometricUnlock(true);
      })();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (appReady) void SplashScreen.hideAsync();
  }, [appReady]);

  async function handleSignedIn(next: MobileSession) {
    clearStepUp();
    setSession(next);
    setBiometricUnlock(false);
    if (next.mustChangePassword) return;
    try {
      const [nextPolicy, availability, meta] = await Promise.all([
        loadMobileAuthPolicy(),
        inspectBiometricAvailability(),
        loadBiometricMeta(),
      ]);
      setPolicy(nextPolicy);
      cacheMobileAuthPolicy(nextPolicy);
      if (!meta && nextPolicy.biometricLoginPolicy !== 'disabled' && availability.canProtectSecrets) {
        setOfferEnrolment(true);
      }
    } catch {
      return;
    }
  }

  const skipEnrolment = useCallback(() => setOfferEnrolment(false), []);

  if (!appReady) return null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        {biometricUnlock ? (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <BiometricLock
              onUnlocked={(next) => {
                clearStepUp();
                setSession(next);
                setBiometricUnlock(false);
              }}
              onUsePassword={() => {
                clearStepUp();
                setBiometricUnlock(false);
                setSession(null);
              }}
            />
          </ScrollView>
        ) : session ? (
          session.mustChangePassword
            ? (
              <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                <ForcedPasswordChange email={session.email} onCompleted={handleSignedIn} />
              </ScrollView>
            )
            : offerEnrolment
              ? (
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                  <BiometricEnrolment
                    email={session.email}
                    onEnabled={skipEnrolment}
                    onSkip={skipEnrolment}
                  />
                </ScrollView>
              )
              : <Workspace session={session} onSignedOut={() => { setSession(null); setOfferEnrolment(false); }} />
        ) : <AuthFlow onSignedIn={handleSignedIn} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Workspace({ session, onSignedOut }: { session: MobileSession; onSignedOut: () => void }) {
  const [route, setRoute] = useState<Route>({ name: 'dashboard' });
  const [capabilities, setCapabilities] = useState<BuyerCapabilities | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);

  useEffect(() => {
    if (session.role !== 'USER') return;
    loadCapabilities().then(setCapabilities).catch(() => setCapabilities(null));
  }, [session.role]);

  useEffect(() => {
    function handlePaymentReturn(url: string) {
      const parsed = ExpoLinking.parse(url);
      if (parsed.scheme !== 'tradetender' || parsed.path !== 'payment/return') return;
      const paymentId = typeof parsed.queryParams?.payment_id === 'string' ? parsed.queryParams.payment_id : undefined;
      setPendingPayment((current) => current ? { ...current, paymentId: paymentId ?? current.paymentId } : current);
    }
    Linking.getInitialURL().then((url) => { if (url) handlePaymentReturn(url); }).catch(() => undefined);
    const subscription = Linking.addEventListener('url', (event) => handlePaymentReturn(event.url));
    return () => subscription.remove();
  }, []);

  const handleSignOut = useCallback(async () => {
    await revokeMobileSession();
    onSignedOut();
  }, [onSignedOut]);

  const tab = tabForRoute(route);
  const nested = route.name !== 'dashboard' && route.name !== 'tenders' && route.name !== 'opportunities' && route.name !== 'profile';

  const screen = useMemo(() => {
    switch (route.name) {
      case 'dashboard': return <DashboardScreen go={setRoute} />;
      case 'tenders': return <TendersScreen canRaiseTender={capabilities?.canRaiseTender !== false} go={setRoute} />;
      case 'createTender': return <CreateTenderScreen go={setRoute} />;
      case 'tender': return <TenderScreen capabilities={capabilities} pendingPayment={pendingPayment} tenderId={route.tenderId} onPendingPayment={setPendingPayment} />;
      case 'awarded': return <AwardedScreen go={setRoute} />;
      case 'opportunities': return <OpportunitiesScreen go={setRoute} />;
      case 'quotes': return <SubmittedQuotesScreen go={setRoute} />;
      case 'verification': return <VerificationScreen />;
      case 'billing': return <BillingScreen />;
      case 'profile': return <ProfileScreen email={session.email} go={setRoute} onSignOut={() => { void handleSignOut(); }} />;
      case 'support': return <SupportScreen />;
    }
  }, [capabilities, handleSignOut, pendingPayment, route, session.email]);

  if (session.role === 'SUPER_USER') {
    return (
      <View style={styles.content}>
        <View style={styles.header}>
          <Image alt="Trade Tender" accessibilityLabel="Trade Tender" source={require('./assets/trade-tender-logo.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <Title>Administration is on the web</Title>
        <Body>Owner and Super User tools stay on the Trade Tender website. This app is the Buyer and Supplier workspace.</Body>
        <PrimaryButton label="Sign out" onPress={() => { void handleSignOut(); }} />
      </View>
    );
  }

  return (
    <View style={styles.workspace}>
      <View style={styles.header}>
        <Image alt="Trade Tender" accessibilityLabel="Trade Tender" source={require('./assets/trade-tender-logo.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <View style={styles.toolbar}>
        {nested && (
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={() => {
              if (tab === 'buying') setRoute({ name: 'tenders' });
              else if (tab === 'supplying') setRoute({ name: 'opportunities' });
              else if (tab === 'account') setRoute({ name: 'profile' });
              else setRoute({ name: 'dashboard' });
            }}
            style={styles.back}
          >
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        )}
        <Text style={styles.screenTitle}>{titleForRoute(route)}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {screen}
      </ScrollView>
      <View style={styles.tabs}>
        {WORKSPACE_TABS.map((item) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === item.id }}
            key={item.id}
            onPress={() => setRoute(item.route)}
            style={styles.tab}
          >
            <Text style={[styles.tabLabel, tab === item.id && styles.tabLabelActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.lightGrey,
  },
  workspace: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.foundationNavy,
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  logo: {
    height: 64,
    width: 180,
  },
  toolbar: {
    alignItems: 'center',
    backgroundColor: colors.siteWhite,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: tapMinHeight,
    paddingHorizontal: 16,
  },
  back: {
    marginRight: 12,
    minHeight: tapMinHeight,
    justifyContent: 'center',
  },
  backText: {
    color: colors.tradeBlue,
    fontFamily: fonts.headlineSemi,
    fontSize: 15,
  },
  screenTitle: {
    color: colors.foundationNavy,
    fontFamily: fonts.headlineSemi,
    fontSize: 18,
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },
  tabs: {
    backgroundColor: colors.siteWhite,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  tab: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: tapMinHeight,
    paddingVertical: 10,
  },
  tabLabel: {
    color: colors.concreteGrey,
    fontFamily: fonts.bodySemi,
    fontSize: 13,
  },
  tabLabelActive: {
    color: colors.tradeBlue,
  },
  content: {
    padding: 24,
  },
});
