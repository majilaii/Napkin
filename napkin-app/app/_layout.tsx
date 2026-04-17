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
import { Colors, Type } from '@/constants/theme';
import { useColorScheme as useScheme } from '@/hooks/use-color-scheme';

SplashScreen.preventAutoHideAsync();

function BottomNavBar() {
  const segments = useSegments();
  const router = useRouter();
  const scheme = useScheme() ?? 'light';
  const palette = Colors[scheme];
  const insets = useSafeAreaInsets();

  // Only show on tab screens
  const inTabs = segments[0] === '(tabs)';
  if (!inTabs) return null;

  // Which tab is active?
  const activeTab = segments[1] ?? 'tables';

  return (
    <View style={[navStyles.bar, { backgroundColor: palette.surfaceContainerLow, paddingBottom: insets.bottom > 0 ? insets.bottom : 12 }]}>
      {/* Tables tab */}
      <Pressable
        onPress={() => router.replace('/tables')}
        style={navStyles.tab}
      >
        <Ionicons name="restaurant-outline" size={24} color={activeTab === 'tables' ? palette.tabIconSelected : palette.tabIconDefault} />
        <Text style={[Type.labelSmall, { color: activeTab === 'tables' ? palette.tabIconSelected : palette.tabIconDefault, marginTop: 2 }]}>Tables</Text>
      </Pressable>

      {/* Center + button */}
      <Pressable
        onPress={() => router.push('/create-entry')}
        style={navStyles.addButton}
      >
        <View style={[navStyles.addCircle, { backgroundColor: palette.primary }]}>
          <Ionicons name="add" size={28} color="#fff" />
        </View>
      </Pressable>

      {/* Profile tab */}
      <Pressable
        onPress={() => router.replace('/profile')}
        style={navStyles.tab}
      >
        <Ionicons name="person-circle-outline" size={24} color={activeTab === 'profile' ? palette.tabIconSelected : palette.tabIconDefault} />
        <Text style={[Type.labelSmall, { color: activeTab === 'profile' ? palette.tabIconSelected : palette.tabIconDefault, marginTop: 2 }]}>Profile</Text>
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
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 20,
    flex: 1,
  },
  addButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
  },
  addCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
});

function RootLayoutNav() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

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
            name="table-night"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="table-night-detail"
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fcf9f4' }}>
        <ActivityIndicator size="small" color="#a03f28" />
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
