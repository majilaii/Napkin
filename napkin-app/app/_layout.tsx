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

import { useEffect } from 'react';
import { ActivityIndicator, View, Pressable, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { ToastProvider } from '@/providers/ToastProvider';
import { useProcessImportQueue } from '@/hooks/wishlist/useProcessImportQueue';
import { usePublishCollectionsSnapshot } from '@/hooks/wishlist/usePublishCollectionsSnapshot';
import { Colors } from '@/constants/theme';
import { useColorScheme as useScheme } from '@/hooks/use-color-scheme';

SplashScreen.preventAutoHideAsync();

/**
 * BottomNavBar — TICKET-070 Phase A IA update.
 *
 * 4 tabs: Table · Search · Wishlist · Profile
 * Icons: 21px outline, labels 8px/600 uppercase ls1.2
 * Journal exits the nav (route stays alive for deep links).
 * Profile tab added with person-circle-outline icon.
 *
 * Wishlist routing: points to the existing Stack route `app/wishlist.tsx`
 * (`/wishlist`). inTabs includes `segments[0] === 'wishlist'` so the bar
 * remains visible there.
 */
function BottomNavBar() {
  const segments = useSegments();
  const router = useRouter();
  const scheme = useScheme() ?? 'light';
  const palette = Colors[scheme];
  const insets = useSafeAreaInsets();

  // Show on (tabs) screens AND on the wishlist Stack screen
  const inTabs = segments[0] === '(tabs)' || segments[0] === 'wishlist';
  if (!inTabs) return null;

  // Active tab detection
  const seg1 = segments[1] as string | undefined;
  // When on the wishlist Stack route, segments[0] = 'wishlist', segments[1] = undefined
  const activeTab =
    segments[0] === 'wishlist'
      ? 'wishlist'
      : seg1 ?? 'tables';

  const tabColor = (name: string) =>
    activeTab === name ? palette.tabIconSelected : palette.tabIconDefault;

  const labelStyle = (name: string) => [
    navStyles.label,
    { color: tabColor(name) },
  ];

  return (
    <View
      style={[
        navStyles.bar,
        {
          backgroundColor: 'rgba(255,253,248,0.85)',
          paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
        },
      ]}
    >
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

      {/* Wishlist — points to existing Stack route */}
      <Pressable
        onPress={() => router.replace('/wishlist')}
        style={navStyles.tab}
        accessibilityLabel="Wishlist"
        accessibilityRole="tab"
      >
        <Ionicons name="location-outline" size={21} color={tabColor('wishlist')} />
        <Text style={labelStyle('wishlist')}>Wishlist</Text>
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
  bar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 0,
    // canvas: box-shadow: 0 -8px 30px rgba(0,0,0,0.04)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.04,
    shadowRadius: 30,
    elevation: 4,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    flex: 1,
    gap: 4,
  },
  label: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});

function RootLayoutNav() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // TICKET-083 Part B: drain the async video-import queue in the background
  // (launch + every foreground). Self-gated on session; safe no-op when signed
  // out or when the native OCR module is absent.
  useProcessImportQueue();

  // Publish lists + tables to the App Group so the share extension's destination
  // picker can render them (separate process — can't read the app's cache).
  usePublishCollectionsSnapshot();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!session && !inAuthGroup) {
      router.replace('/auth');
    } else if (session && inAuthGroup) {
      router.replace('/tables');
    }
  }, [session, isLoading, segments, router]);

  return (
    <ThemeProvider value={DefaultTheme}>
      <View style={{ flex: 1 }}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
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
            name="lists"
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
            name="regulars"
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
        </Stack>
        <BottomNavBar />
      </View>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
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
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <RootLayoutNav />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
