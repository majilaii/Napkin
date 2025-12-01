import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const inAuthGroup = segments[0] === 'auth';

      if (!session && !inAuthGroup) {
        // Redirect to the sign-in page.
        router.replace('/auth');
      } else if (session && inAuthGroup) {
        // Redirect away from the sign-in page.
        router.replace('/(tabs)/explore');
      }
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      const inAuthGroup = segments[0] === 'auth';
      if (!session && !inAuthGroup) {
        router.replace('/auth');
      } else if (session && inAuthGroup) {
        router.replace('/(tabs)/explore');
      }
    });
  }, [segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
