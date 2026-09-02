import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native';
import React from 'react';

import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * TICKET-228: four-tab layout — FEED · TABLE · PLACES · PROFILE.
 * TICKET-070: IA update — Profile replaces Journal in the nav.
 *   - profile: activated (href: null removed)
 *   - journal: demoted to hidden (deep-link safe; no longer a tab button)
 *   - wishlist: still a reachable Stack route and marks Places active
 *
 * The built-in tab bar is HIDDEN (`display: 'none'`) — navigation is handled
 * entirely by the custom BottomNavBar in `app/_layout.tsx`.
 * This file only registers route names so Expo Router knows which files
 * belong to the (tabs) group.
 *
 * Active routes (appear in BottomNavBar):
 *   - feed     (Feed tab — TICKET-098 friends feed + trending rail, leftmost)
 *   - tables   (Table tab)
 *   - places   (Places tab)
 *   - profile  (Profile tab — TICKET-070)
 *
 * Hidden routes (preserved for deep-link safety):
 *   - journal  (demoted from tab; /journal still reachable via deep link)
 *   - log      (legacy)
 */
export default function TabsLayout() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: palette.tabIconSelected,
                tabBarInactiveTintColor: palette.tabIconDefault,
                tabBarStyle: [
                    styles.tabBar,
                    { backgroundColor: palette.surfaceContainerLow, display: 'none' },
                ],
                tabBarLabelStyle: [Type.labelSmall, { marginTop: 2 }],
            }}
        >
            {/* === Active nav routes === */}
            <Tabs.Screen
                name="feed"
                options={{
                    title: 'Feed',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="newspaper-outline" size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="tables"
                options={{
                    title: 'Table',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="restaurant-outline" size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="places"
                options={{
                    title: 'Places',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="location-outline" size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="profile"
                options={{
                    title: 'Profile',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="person-circle-outline" size={size} color={color} />
                    ),
                }}
            />

            {/* === Hidden routes — preserved for deep-link safety === */}
            {/* journal: demoted from tab in TICKET-070; /journal still reachable */}
            <Tabs.Screen
                name="search"
                options={{ href: null }}
            />
            <Tabs.Screen
                name="journal"
                options={{ href: null }}
            />
            <Tabs.Screen
                name="log"
                options={{ href: null }}
            />
        </Tabs>
    );
}

const styles = StyleSheet.create({
    tabBar: {
        borderTopWidth: 0,
        elevation: 0,
        height: 72,
        paddingTop: 8,
        paddingBottom: 12,
    },
});
