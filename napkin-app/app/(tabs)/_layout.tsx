import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native';
import React from 'react';

import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * TICKET-069: Skinny-five tab layout.
 *
 * The built-in tab bar is HIDDEN (`display: 'none'`) — navigation is handled
 * entirely by the custom BottomNavBar in `app/_layout.tsx`.
 * This file only registers route names so Expo Router knows which files
 * belong to the (tabs) group.
 *
 * Registered routes:
 *   - tables   (Table tab)
 *   - search   (Search tab)
 *   - journal  (Journal tab — was href:null, now an active route)
 *   - feed     (hidden, legacy — kept for deep-link safety)
 *   - log      (hidden, legacy — kept for deep-link safety; + FAB removed)
 *   - profile  (hidden, legacy — profile reachable via gear on Journal header)
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
            {/* === Active skinny-five routes === */}
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
                name="search"
                options={{
                    title: 'Search',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="search-outline" size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="journal"
                options={{
                    title: 'Journal',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="book-outline" size={size} color={color} />
                    ),
                }}
            />

            {/* === Legacy / hidden routes — preserved for deep-link safety === */}
            <Tabs.Screen
                name="feed"
                options={{ href: null }}
            />
            <Tabs.Screen
                name="log"
                options={{ href: null }}
            />
            <Tabs.Screen
                name="profile"
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
