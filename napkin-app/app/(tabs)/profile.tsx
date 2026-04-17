/**
 * Profile tab — renders the merged profile screen inline.
 * Re-uses the same components as /u/[identifier] but stays inside the tab.
 */
import React from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile } from '@/hooks/users/useUserProfile';
import {
    ProfileHeader,
    PalateSection,
    TablesInCommonSection,
    NotFoundState,
} from '@/components/profile';

export default function ProfileTab() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { data: result, isLoading, error } = useUserProfile(user?.id);

    const profileData = result?.data ?? null;

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            {/* Top bar with gear icon */}
            <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                <Text style={[Type.headlineMedium, { color: palette.text }]}>Profile</Text>
                <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
                    <Ionicons name="settings-outline" size={24} color={palette.text} />
                </Pressable>
            </View>

            {/* Loading */}
            {isLoading && (
                <View style={styles.center}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            )}

            {/* Error */}
            {!isLoading && error && (
                <View style={styles.center}>
                    <Text style={[Type.body, { color: palette.textSecondary, textAlign: 'center' }]}>
                        Couldn&apos;t load your profile
                    </Text>
                </View>
            )}

            {/* Profile content */}
            {!isLoading && !error && profileData && (
                <ScrollView
                    contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
                    showsVerticalScrollIndicator={false}
                >
                    <ProfileHeader
                        profile={profileData.profile}
                        isSelf={true}
                        relationship="self"
                    />

                    {profileData.stats && (
                        <PalateSection
                            stats={profileData.stats}
                            recentlyLogged={profileData.recently_logged ?? []}
                            publicLists={profileData.public_lists ?? []}
                            isSelf={true}
                        />
                    )}

                    {profileData.tables_in_common && profileData.tables_in_common.length > 0 && (
                        <TablesInCommonSection
                            previews={profileData.tables_in_common}
                            targetUserId={user!.id}
                            isSelf={true}
                        />
                    )}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.md,
        paddingBottom: Spacing.sm,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
