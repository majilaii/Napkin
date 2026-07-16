import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
  Newsreader_500Medium_Italic,
  Newsreader_600SemiBold,
  Newsreader_700Bold,
  Newsreader_800ExtraBold,
} from '@expo-google-fonts/newsreader';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import * as SplashScreen from 'expo-splash-screen';

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View, Pressable, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { ToastProvider } from '@/providers/ToastProvider';
import { useProcessImportQueue } from '@/hooks/wishlist/useProcessImportQueue';
import { useLargeImportKickoffTrigger } from '@/hooks/wishlist/useLargeImportKickoffTrigger';
import { usePublishCollectionsSnapshot } from '@/hooks/wishlist/usePublishCollectionsSnapshot';
import { NotifPermissionSheet } from '@/components/notifications';
import {
  configureNotifications,
  addNotificationResponseListener,
  getInitialNotificationUrl,
  onNotifPromptRequest,
} from '@/lib/localNotify';
import { Colors } from '@/constants/theme';
import { useColorScheme as useScheme } from '@/hooks/use-color-scheme';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { track, trackError, flushNow } from '@/lib/track';
import { initSentry, captureError, wrapRootComponent } from '@/lib/sentry';
import { ConnectivityProvider } from '@/providers/ConnectivityProvider';
import { getPreviewOnboardingOnLaunch } from '@/lib/devPrefs';

// TICKET-121: before any render. No-op until EXPO_PUBLIC_SENTRY_DSN exists.
initSentry();

SplashScreen.preventAutoHideAsync();

// Fatal-JS-error visibility (launch readiness): there is no crash SDK yet, so
// forward fatal errors into our own events table before the app dies. Chained
// so RN's own handler (redbox in dev, crash in release) still runs. The guard
// stops Metro Fast Refresh from re-wrapping the chain on every save.
if (!(globalThis as { __napkinFatalHook?: boolean }).__napkinFatalHook) {
  (globalThis as { __napkinFatalHook?: boolean }).__napkinFatalHook = true;
  const prevFatalHandler = ErrorUtils.getGlobalHandler?.();
  ErrorUtils.setGlobalHandler?.((error, isFatal) => {
    try {
      if (isFatal) {
        trackError(error, 'fatal');
        captureError(error, { context: 'fatal' });
        flushNow(); // best-effort — the debounce would never fire before the crash
      }
    } catch {
      /* never block the handler chain */
    }
    prevFatalHandler?.(error, isFatal);
  });
}

/**
 * BottomNavBar — TICKET-070 Phase A IA update; TICKET-098 adds Feed;
 * TICKET-130 reshapes the CONTAINER to a detached floating pill
 * (founder-requested 2026-07-07 — supersedes the edge-to-edge opaque bar of
 * 2026-07-02 for the container only).
 *
 * 5 tabs: Feed · Table · Search · Wishlist · Profile
 * Icons: 21px outline + labels — SAME icons, SAME labels, SAME routes/handlers
 * as before the pill (items are untouched; only the container changed).
 * Journal exits the nav (route stays alive for deep links). Post-auth redirect
 * stays `/wishlist`.
 *
 * ARCHITECT-REVIEW: TICKET-130 §7 specs a terracotta `+` button (46×46,
 * marginTop −20) for the pill, but the nav has had NO `+` since TICKET-069
 * (skinny five: FAB dead — LogSheet on the restaurant page is the sole write
 * path). Adding one would invent a new route/handler, contradicting the same
 * ticket's "SAME routes/badges/handlers" constraint, so the pill ships with
 * the 5 existing tabs only. If the founder wants the `+` back, a follow-up
 * must spec what it opens.
 *
 * Wishlist routing: points to the existing Stack route `app/wishlist.tsx`
 * (`/wishlist`). inTabs includes `segments[0] === 'wishlist'` so the bar
 * remains visible there.
 */
// TICKET-130 pill background — mock literals (surfaceNote/card at 0.94).
const PILL_BG = {
  light: 'rgba(255,253,248,0.94)',
  dark: 'rgba(42,39,36,0.94)',
} as const;

function BottomNavBar() {
  const segments = useSegments();
  const router = useRouter();
  const scheme = useScheme() ?? 'light';
  const palette = Colors[scheme];
  const insets = useSafeAreaInsets();

  // Show on (tabs) screens AND on the wishlist Stack screen
  const inTabs = segments[0] === '(tabs)' || segments[0] === 'wishlist';
  if (!inTabs) return null;

  // Active tab detection. Widen first: without generated .expo/types,
  // useSegments() is the tuple [string] and segments[1] is a TS2493.
  const seg1 = (segments as string[])[1] as string | undefined;
  // When on the wishlist Stack route, segments[0] = 'wishlist', segments[1] = undefined
  const activeTab =
    segments[0] === 'wishlist'
      ? 'wishlist'
      : seg1 ?? 'tables';

  // Active terracotta, inactive textSecondary (TICKET-130 pill spec).
  const tabColor = (name: string) =>
    activeTab === name ? palette.tabIconSelected : palette.textSecondary;

  const labelStyle = (name: string) => [
    navStyles.label,
    { color: tabColor(name) },
  ];

  return (
    <View
      style={[
        navStyles.bar,
        {
          // TICKET-130 floating pill — near-opaque warm note-white / dark card
          // (mock literals; surfaceNote/card at 0.94 — not new tokens). Keyed
          // by scheme (not compared) — useColorScheme is hard-forced 'light'.
          backgroundColor: PILL_BG[scheme],
          bottom: Math.max(insets.bottom - 12, 10),
        },
      ]}
    >
      {/* Feed — TICKET-098, leftmost */}
      <Pressable
        onPress={() => router.replace('/feed')}
        style={navStyles.tab}
        accessibilityLabel="Feed"
        accessibilityRole="tab"
      >
        <Ionicons name="newspaper-outline" size={21} color={tabColor('feed')} />
        <Text style={labelStyle('feed')}>Feed</Text>
      </Pressable>

      {/* Table */}
      <Pressable
        onPress={() => router.replace('/tables')}
        style={navStyles.tab}
        accessibilityLabel="Table"
        accessibilityRole="tab"
      >
        <Ionicons name="restaurant-outline" size={21} color={tabColor('tables')} />
        <Text style={labelStyle('tables')}>Table</Text>
      </Pressable>

      {/* Search */}
      <Pressable
        onPress={() => router.replace('/search')}
        style={navStyles.tab}
        accessibilityLabel="Search"
        accessibilityRole="tab"
      >
        <Ionicons name="search-outline" size={21} color={tabColor('search')} />
        <Text style={labelStyle('search')}>Search</Text>
      </Pressable>

      {/* Map (TICKET-134 — formerly Wishlist) — points to existing /wishlist route */}
      <Pressable
        onPress={() => router.replace('/wishlist')}
        style={navStyles.tab}
        accessibilityLabel="Map"
        accessibilityRole="tab"
      >
        <Ionicons name="map-outline" size={21} color={tabColor('wishlist')} />
        <Text style={labelStyle('wishlist')}>Map</Text>
      </Pressable>

      {/* Profile */}
      <Pressable
        onPress={() => router.replace('/profile')}
        style={navStyles.tab}
        accessibilityLabel="Profile"
        accessibilityRole="tab"
      >
        <Ionicons name="person-circle-outline" size={21} color={tabColor('profile')} />
        <Text style={labelStyle('profile')}>Profile</Text>
      </Pressable>
    </View>
  );
}

const navStyles = StyleSheet.create({
  // TICKET-130 — detached floating pill (bottom is set inline from insets).
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderRadius: 26,
    paddingVertical: 8,
    // Ambient pill shadow — mock: 0 8px 30px rgba(28,28,25,0.12)
    shadowColor: '#1c1c19',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 30,
    elevation: 6,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    flex: 1,
    gap: 4,
  },
  label: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 8.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});

// Nav theme pinned to warm paper. @react-navigation's DefaultTheme paints
// card + background pure white; every screen paints Colors.light.background, so
// the white card peeked through during every push/pop → flicker. Derive from
// DefaultTheme (light-only, matching the app's unconditional DefaultTheme pin).
const NavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.light.background,
    card: Colors.light.background,
  },
};

function RootLayoutNav() {
  const { session, isLoading, onboardedAt } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [previewOnLaunch, setPreviewOnLaunch] = useState<boolean | undefined>(undefined);
  const previewLaunchConsumed = useRef(false);

  useEffect(() => {
    let alive = true;
    getPreviewOnboardingOnLaunch().then((value) => {
      if (alive) setPreviewOnLaunch(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  // TICKET-083 Part B: drain the async video-import queue in the background
  // (launch + every foreground). Self-gated on session; safe no-op when signed
  // out or when the native OCR module is absent.
  useProcessImportQueue();

  // TICKET-152: route to the kickoff sheet when a large Maps list enumerates.
  useLargeImportKickoffTrigger();

  // Publish lists + tables to the App Group so the share extension's destination
  // picker can render them (separate process — can't read the app's cache).
  usePublishCollectionsSnapshot();

  // TICKET-120: local import-completion notifications. Configure the foreground
  // handler + Android channel once, and route a tap — both the live listener and
  // the cold-start last-response — to the imports hub. All calls degrade to no-ops
  // when expo-notifications is absent (Expo Go / web / unlinked).
  const [notifSheetVisible, setNotifSheetVisible] = useState(false);
  useEffect(() => {
    configureNotifications();
    const unsub = addNotificationResponseListener((url) => router.push(url as any));
    getInitialNotificationUrl().then((url) => {
      if (url) router.push(url as any);
    });
    return unsub;
  }, [router]);

  // The drain raises this when an import is in flight, permission isn't granted, and
  // the cadence gate allows — render the soft pre-permission sheet.
  useEffect(() => onNotifPromptRequest(() => setNotifSheetVisible(true)), []);

  useEffect(() => {
    // Resolve the local preview preference before any launch routing. Signed-in
    // decisions also wait for the tri-state onboarding gate below, so auth never
    // routes once to Wishlist and then again to the preview.
    if (isLoading || previewOnLaunch === undefined) return;

    const inAuthGroup = segments[0] === 'auth';
    // TICKET-090: the password-recovery deep link must survive both redirects —
    // it starts signed-out (would bounce to /auth) and setSession() flips to
    // signed-in mid-form (would bounce to /wishlist before the new password).
    const inRecovery = segments[0] === 'reset-password';
    // TICKET-107: a pending share/handoff resume (auth.tsx redirects to these)
    // must finish BEFORE onboarding — "import resume wins."
    const inOnboarding = segments[0] === 'onboarding';
    const inResume = segments[0] === 'import' || segments[0] === 'handoff' || segments[0] === 'join-table';

    if (!session) {
      if (!inAuthGroup && !inRecovery) router.replace('/auth');
      return;
    }

    // TICKET-107: onboardedAt is TRI-STATE (undefined = still loading). Wait
    // for it to resolve before redirecting so a fresh signup routes straight
    // to /onboarding instead of flashing /wishlist then bouncing. AuthProvider
    // always resolves it to null-or-string (read errors fall back to
    // "onboarded"), so this never strands a user on /auth.
    if (onboardedAt === undefined) return;

    if (onboardedAt === null) {
      // Normal onboarding owns this launch. Consuming the optional preview now
      // prevents completion from immediately sending the user through it again.
      previewLaunchConsumed.current = true;
      if (!inRecovery && !inOnboarding && !inResume) {
        router.replace('/onboarding');
      }
      return;
    }

    if (
      previewOnLaunch &&
      !previewLaunchConsumed.current &&
      !inRecovery &&
      !inResume
    ) {
      previewLaunchConsumed.current = true;
      if (!inOnboarding) router.replace('/onboarding');
      return;
    }

    if (inAuthGroup) {
      // Launch-readiness (2026-07-03): onboarded users land on Wishlist, not
      // Tables — the capture surface is the product's first-value moment.
      router.replace('/wishlist');
    }
  }, [session, isLoading, onboardedAt, previewOnLaunch, segments, router]);

  // TICKET-088: app_open on launch + every foreground (D1/D7/D30 cohorts).
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return;
    track('app_open', {});
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') track('app_open', {});
    });
    return () => sub.remove();
  }, [userId]);

  return (
    <ThemeProvider value={NavTheme}>
      <View style={{ flex: 1 }}>
        {/* Root catch: a render error anywhere used to white-screen the whole
            app with zero trace (only entry-detail was wrapped). */}
        <ErrorBoundary
          screen="root"
          onError={(e) => {
            trackError(e, 'root-boundary');
            captureError(e, { context: 'root-boundary' });
          }}
        >
        <Stack
          screenOptions={{
            // Card content never flashes white mid-transition — see NavTheme.
            contentStyle: { backgroundColor: Colors.light.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
          {/* TICKET-107: first-sign-in onboarding stack (name · city · teach) */}
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen
            name="create-entry"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="log-meal"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="table-night"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="table-night-detail"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="restaurant/[id]"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="supper/[id]"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="gathering/[id]"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="lists"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="taste"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="list/[id]"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="list/[id]/edit"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="list/new"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="u/[identifier]"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="spots"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="reviews"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="restaurant-reviews"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="settings"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="wishlist"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="entry-detail"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="share-detail"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="table/[id]/settings"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="table/[id]/atlas/[city]"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="seed-from-solo"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="create-table"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="diary"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="follows"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="looking-back"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="day/[date]"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="notifications"
            options={{ headerShown: false }}
          />
          {/* TICKET-055: iOS share extension deep-link landing */}
          <Stack.Screen
            name="import"
            options={{ headerShown: false, presentation: 'card' }}
          />
          {/* TICKET-072: wishlist handoff receive screen */}
          <Stack.Screen
            name="handoff"
            options={{ headerShown: false, presentation: 'card' }}
          />
          {/* Table invite receive screen */}
          <Stack.Screen
            name="join-table"
            options={{ headerShown: false, presentation: 'card' }}
          />
        </Stack>
        </ErrorBoundary>
        <BottomNavBar />
        {/* TICKET-120: soft pre-permission sheet, event-triggered by the drain. */}
        <NotifPermissionSheet
          visible={notifSheetVisible}
          onClose={() => setNotifSheetVisible(false)}
        />
      </View>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

function RootLayout() {
  const [fontsLoaded] = useFonts({
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium,
    Newsreader_500Medium_Italic,
    Newsreader_600SemiBold,
    Newsreader_700Bold,
    Newsreader_800ExtraBold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.background }}>
        <ActivityIndicator size="small" color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ConnectivityProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <RootLayoutNav />
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ConnectivityProvider>
    </GestureHandlerRootView>
  );
}

// TICKET-121: Sentry.wrap when the DSN is live; plain export otherwise.
export default wrapRootComponent(RootLayout);
