/**
 * /u/[identifier] — merged public profile screen.
 *
 * Identifier is either a uuid (for private users reached from in-app taps)
 * or a username (for public users sharing externally).
 *
 * Section composition is driven by viewer_target_relationship:
 *   self:               Header + Palate + "Your Tables"
 *   public_and_tables:  Header + Palate + "Tables in common"
 *   public_only:        Header + Palate
 *   tables_in_common:   Header + "Tables in common" (no Palate)
 *   none:               "This profile isn't available." full-screen
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
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUserProfile } from '@/hooks/users/useUserProfile';
import {
    ProfileHeader,
    PalateSection,
    TablesInCommonSection,
    NotFoundState,
} from '@/components/profile';

export default function ProfileScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { identifier } = useLocalSearchParams<{ identifier: string }>();
    const { data: result, isLoading, error } = useUserProfile(identifier);

    const isNotFound = result?.isNotFound ?? false;
    const profileData = result?.data ?? null;

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Top bar with back nav */}
                <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                    </Pressable>
                    <View style={{ width: 40 }} />
                </View>

                {/* Loading */}
                {isLoading && (
                    <View style={styles.center}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                )}

                {/* Error */}
                {!isLoading && error && !isNotFound && (
                    <View style={styles.center}>
                        <Text style={[Type.headlineMedium, { color: palette.text, textAlign: 'center' }]}>
                            Couldn&apos;t load this profile
                        </Text>
                        <Pressable onPress={() => router.back()} style={{ marginTop: Spacing.md }}>
                            <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                        </Pressable>
                    </View>
                )}

                {/* Not found — privacy-safe 404 */}
                {!isLoading && isNotFound && <NotFoundState />}

                {/* Content */}
                {!isLoading && !error && profileData && (
                    <ScrollView
                        contentContainerStyle={[
                            styles.scrollContent,
                            { paddingBottom: insets.bottom + 40 },
                        ]}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Header — always shown when we have data */}
                        <ProfileHeader
                            profile={profileData.profile}
                            isSelf={profileData.is_self}
                            relationship={profileData.viewer_target_relationship}
                        />

                        {/* Palate section — self, public_only, public_and_tables */}
                        {(profileData.viewer_target_relationship === 'self' ||
                            profileData.viewer_target_relationship === 'public_only' ||
                            profileData.viewer_target_relationship === 'public_and_tables') &&
                            profileData.stats && (
                                <PalateSection
                                    stats={profileData.stats}
                                    publicLists={profileData.public_lists ?? []}
                                    recentlyLogged={profileData.recently_logged ?? []}
                                    isSelf={profileData.is_self}
                                />
                            )}

                        {/* Tables-in-common section — self, tables_in_common, public_and_tables */}
                        {(profileData.viewer_target_relationship === 'self' ||
                            profileData.viewer_target_relationship === 'tables_in_common' ||
                            profileData.viewer_target_relationship === 'public_and_tables') && (
                            <TablesInCommonSection
                                previews={profileData.tables_in_common}
                                targetUserId={profileData.profile.user_id}
                                isSelf={profileData.is_self}
                            />
                        )}
                    </ScrollView>
                )}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
    },
    scrollContent: {
        paddingTop: Spacing.md,
    },
});
