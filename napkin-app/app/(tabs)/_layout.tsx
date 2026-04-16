import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import React from 'react';

import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Three-tab nav: Tables | (+) Log | Settings
 *
 * The centre "Log" tab is a terracotta circle that opens the create-entry
 * modal instead of navigating to a tab screen.
 */
export default function TabsLayout() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: palette.tabIconSelected,
                tabBarInactiveTintColor: palette.tabIconDefault,
                tabBarStyle: [
                    styles.tabBar,
                    { backgroundColor: palette.surfaceContainerLow },
                ],
                tabBarLabelStyle: [Type.labelSmall, { marginTop: 2 }],
            }}
        >
            {/* Hidden — file exists but not a visible tab */}
            <Tabs.Screen
                name="journal"
                options={{ href: null }}
            />
            <Tabs.Screen
                name="friends"
                options={{ href: null }}
            />

            <Tabs.Screen
                name="tables"
                options={{
                    title: 'Tables',
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
                name="log"
                options={{
                    title: '',
                    tabBarIcon: () => (
                        <View
                            style={{
                                width: 44,
                                height: 44,
                                borderRadius: 22,
                                backgroundColor: palette.primary,
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginBottom: 8,
                            }}
                        >
                            <Ionicons name="add" size={26} color="#fff" />
                        </View>
                    ),
                    tabBarButton: ({ ref: _ref, ...props }) => (
                        <Pressable
                            {...props}
                            onPress={() => router.push('/create-entry')}
                        />
                    ),
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    title: 'Settings',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="settings-outline" size={size} color={color} />
                    ),
                }}
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
