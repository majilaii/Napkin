/**
 * PeopleSearchPane — body for the People tab in Search. TICKET-028.
 *
 * Three states:
 *   1. Empty query  → "Suggested" header + merged followingList + recentCompanions (dedupe, cap 10)
 *   2. Query, results found → flat FlatList of PeopleResultRow
 *   3. Query, no results → InviteViaSmsRow
 *
 * Tap on a result → router.push('/u/' + user_id)
 */
import React, { useCallback, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Linking,
    Pressable,
    ActivityIndicator,
    Keyboard,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserSearch } from '@/hooks/users/useUserSearch';
import { useFollowingList } from '@/hooks/users/useFollowingList';
import { useRecentCompanions } from '@/hooks/users/useRecentCompanions';
import type { UserSearchResult } from '@/hooks/users/useUserSearch';
import type { SnapSheetContentContext } from '@/components/sheets/SnapSheet';
import { PeopleResultRow } from './PeopleResultRow';

interface Props {
    query: string;
    debouncedQuery: string;
    /** Optional sheet adapter; legacy callers stay independently scrollable. */
    scrollEnabled?: boolean;
    onScroll?: SnapSheetContentContext['onScroll'];
}

const INVITE_LINK = 'https://napkinapp.com/i/';
const SUGGESTED_CAP = 10;

function InviteViaSmsRow({ query }: { query: string }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const handlePress = () => {
        const body = encodeURIComponent(
            `Come keep a food journal with me on Napkin: ${INVITE_LINK}`
        );
        Linking.openURL(`sms:&body=${body}`);
    };

    return (
        <Pressable
            onPress={handlePress}
            style={({ pressed }) => [
                styles.inviteRow,
                { backgroundColor: pressed ? palette.surfaceContainerLow : 'transparent' },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Invite ${query} via SMS`}
        >
            <View style={[styles.inviteIcon, { backgroundColor: palette.secondaryContainer }]}>
                <Ionicons name="mail-outline" size={20} color={palette.secondary} />
            </View>
            <View style={styles.inviteText}>
                <Text style={[styles.inviteLabel, { color: palette.text }]}>
                    Invite &ldquo;{query}&rdquo; via SMS
                </Text>
                <Text style={[styles.inviteHint, { color: palette.textMuted }]}>
                    Share a link to join Napkin
                </Text>
            </View>
            <Ionicons name="chevron-forward-outline" size={18} color={palette.textMuted} />
        </Pressable>
    );
}

export function PeopleSearchPane({
    query,
    debouncedQuery,
    scrollEnabled = true,
    onScroll,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();

    const hasQuery = query.trim().length > 0;
    const hasDebouncedQuery = debouncedQuery.trim().length > 0;

    // Active search (only when query is non-empty)
    const { data: searchResults, isLoading: isSearchLoading } = useUserSearch(
        debouncedQuery,
        hasDebouncedQuery
    );

    // Suggested people: following list + recent companions (empty-state only)
    const { data: followingList } = useFollowingList(user?.id);
    const { data: recentCompanions } = useRecentCompanions(user?.id);

    // Deduplicated suggested list — following first, then companions, cap at SUGGESTED_CAP
    const suggestedPeople = useMemo<UserSearchResult[]>(() => {
        const seen = new Set<string>();
        const merged: UserSearchResult[] = [];

        for (const u of (followingList ?? [])) {
            if (!seen.has(u.user_id)) {
                seen.add(u.user_id);
                merged.push({ ...u, is_following: true });
            }
            if (merged.length >= SUGGESTED_CAP) break;
        }

        if (merged.length < SUGGESTED_CAP) {
            for (const u of (recentCompanions ?? [])) {
                if (!seen.has(u.user_id)) {
                    seen.add(u.user_id);
                    merged.push(u);
                }
                if (merged.length >= SUGGESTED_CAP) break;
            }
        }

        return merged;
    }, [followingList, recentCompanions]);

    const handleRowPress = useCallback((userId: string) => {
        router.push(`/u/${userId}`);
    }, [router]);

    // ── Loading ───────────────────────────────────────────────────────────

    if (isSearchLoading) {
        return (
            <Pressable style={styles.centered} onPress={Keyboard.dismiss} accessible={false}>
                <ActivityIndicator color={palette.primary} />
            </Pressable>
        );
    }

    const rows = hasQuery ? searchResults ?? [] : suggestedPeople;
    return (
        <Animated.FlatList
            testID="people-search-results"
            data={rows}
            keyExtractor={(item) => item.user_id}
            renderItem={({ item }) => (
                <PeopleResultRow
                    user_id={item.user_id}
                    display_name={item.display_name}
                    avatar_url={item.avatar_url}
                    is_following={item.is_following}
                    onPress={handleRowPress}
                />
            )}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            style={styles.list}
            scrollEnabled={scrollEnabled}
            onScroll={onScroll}
            scrollEventThrottle={16}
            ListHeaderComponent={!hasQuery && rows.length > 0 ? (
                <Text style={[styles.sectionHeader, { color: palette.textMuted }]}>Suggested</Text>
            ) : null}
            ListEmptyComponent={hasQuery ? (
                <InviteViaSmsRow query={debouncedQuery} />
            ) : (
                <Pressable style={styles.centered} onPress={Keyboard.dismiss} accessible={false}>
                    <Text style={[Type.body, styles.emptyHint, { color: palette.textMuted }]}>
                        Search for people on Napkin
                    </Text>
                </Pressable>
            )}
        />
    );
}

const styles = StyleSheet.create({
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: Spacing.xl,
    },
    list: {
        flex: 1,
    },
    sectionHeader: {
        fontFamily: 'Manrope_600SemiBold',
        fontWeight: '600',
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        paddingHorizontal: Spacing.md,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.xs,
    },
    emptyHint: {
        textAlign: 'center',
        paddingHorizontal: Spacing.xl,
        marginTop: Spacing.xl,
    },
    inviteRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
        gap: Spacing.sm + 4,
    },
    inviteIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
    },
    inviteText: {
        flex: 1,
    },
    inviteLabel: {
        ...Type.body,
    },
    inviteHint: {
        ...Type.caption,
        marginTop: 2,
    },
});
