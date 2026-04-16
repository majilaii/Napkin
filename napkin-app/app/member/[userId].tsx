/**
 * Member Profile Screen — Table-scoped persona for a member.
 *
 * Route: /member/[userId]?tableId=X
 *
 * Sections:
 *  1. Header — large avatar, display name, "member since" / former-member label, taste summary
 *  2. Stats strip — avg / entries / rounds
 *  3. Top 5 entries
 *  4. Recent activity (entries + rounds)
 *
 * Authorization is handled server-side; non-members and non-table-users get 403 → error state.
 */
import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
    Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMemberProfile } from '@/hooks/members/useMemberProfile';
import { buildTasteSummary } from '@/lib/memberSummary';
import {
    TasteSummary,
    MemberStatsStrip,
    TopEntriesList,
    RecentActivityList,
} from '@/components/members';

type Palette = typeof Colors.light;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatMemberSince(joinedAt: string | null): string {
    if (!joinedAt) return '';
    const date = new Date(joinedAt);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── Large initials avatar ─────────────────────────────────────────────────

function LargeAvatar({
    name,
    url,
    size,
    palette,
}: {
    name: string;
    url: string | null;
    size: number;
    palette: Palette;
}) {
    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    const tints = [palette.tertiaryFixed, palette.secondaryContainer, palette.primaryMuted];
    const tint = tints[(initials.charCodeAt(0) || 0) % tints.length];

    const baseStyle = {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    };

    if (url) {
        return <Image source={{ uri: url }} style={baseStyle} resizeMode="cover" />;
    }

    return (
        <View style={baseStyle}>
            <Text
                style={{
                    fontFamily: 'Manrope_700Bold',
                    fontSize: size * 0.36,
                    color: palette.text,
                }}
            >
                {initials}
            </Text>
        </View>
    );
}

// ── Section label ─────────────────────────────────────────────────────────

function SectionLabel({ palette, children }: { palette: Palette; children: string }) {
    return (
        <Text
            style={[
                Type.label,
                { color: palette.textSecondary, marginBottom: Spacing.md },
            ]}
        >
            {children}
        </Text>
    );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function MemberProfileScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { userId, tableId } = useLocalSearchParams<{ userId: string; tableId?: string }>();

    // Always call the hook (Rules of Hooks). When tableId is missing the hook
    // is disabled (useMemberProfile guards on !!userId && !!tableId).
    const { data, isLoading, error } = useMemberProfile(userId, tableId);

    // Guard: tableId is required
    if (!tableId) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <Text style={[Type.body, { color: palette.error }]}>
                        This profile isn&apos;t available.
                    </Text>
                    <Pressable onPress={() => router.back()} style={{ marginTop: Spacing.md }}>
                        <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                    </Pressable>
                </View>
            </>
        );
    }

    // Loading state
    if (isLoading) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            </>
        );
    }

    // Error state (includes 403 for non-members / unknown users)
    if (error || !data) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background, padding: Spacing.lg }]}>
                    <Text style={[Type.body, { color: palette.error }]}>
                        Couldn&apos;t load this profile.
                    </Text>
                    {error?.message ? (
                        <Text
                            style={[
                                Type.bodySmall,
                                { color: palette.textMuted, marginTop: Spacing.sm, textAlign: 'center' },
                            ]}
                        >
                            {error.message}
                        </Text>
                    ) : null}
                    <Pressable onPress={() => router.back()} style={{ marginTop: Spacing.md }}>
                        <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                    </Pressable>
                </View>
            </>
        );
    }

    const { profile, is_current_member, stats, top_entries, recent_activity } = data;
    const tasteSummary = buildTasteSummary(stats);
    const memberSince = formatMemberSince(profile.joined_at);

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={{ flex: 1, backgroundColor: palette.background }}>
                <ScrollView
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + 40,
                        paddingTop: insets.top + Spacing.md,
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Back button */}
                    <View style={styles.topBar}>
                        <Pressable onPress={() => router.back()}>
                            <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                        </Pressable>
                    </View>

                    {/* Header — avatar, name, member since, taste summary */}
                    <View style={styles.headerSection}>
                        <LargeAvatar
                            name={profile.display_name}
                            url={profile.avatar_url}
                            size={88}
                            palette={palette}
                        />

                        <View style={{ marginTop: Spacing.md }}>
                            {/* Display name */}
                            <Text style={[Type.displaySmall, { color: palette.text }]}>
                                {profile.display_name}
                            </Text>

                            {/* Member since / former member */}
                            {is_current_member && memberSince ? (
                                <Text
                                    style={[
                                        Type.headlineItalic,
                                        {
                                            color: palette.textMuted,
                                            fontSize: 15,
                                            marginTop: Spacing.xs,
                                        },
                                    ]}
                                >
                                    Member since {memberSince}
                                </Text>
                            ) : !is_current_member ? (
                                <Text
                                    style={[
                                        Type.headlineItalic,
                                        {
                                            color: palette.textMuted,
                                            fontSize: 15,
                                            fontStyle: 'italic',
                                            marginTop: Spacing.xs,
                                        },
                                    ]}
                                >
                                    no longer at this table
                                </Text>
                            ) : null}

                            {/* Taste summary */}
                            <View style={{ marginTop: Spacing.sm }}>
                                <TasteSummary summary={tasteSummary} />
                            </View>
                        </View>
                    </View>

                    {/* Stats strip */}
                    <View style={styles.section}>
                        <MemberStatsStrip stats={stats} />
                    </View>

                    {/* Top 5 entries */}
                    {top_entries.length > 0 && (
                        <View style={styles.section}>
                            <SectionLabel palette={palette}>Top 5 at this Table</SectionLabel>
                            <TopEntriesList entries={top_entries} />
                        </View>
                    )}

                    {/* Recent activity */}
                    <View style={styles.section}>
                        <SectionLabel palette={palette}>Recent Activity</SectionLabel>
                        <RecentActivityList items={recent_activity} />
                    </View>
                </ScrollView>
            </View>
        </>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    topBar: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
    headerSection: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
    section: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl },
});
