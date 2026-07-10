/**
 * Onboarding S4 — Follow suggestions (TICKET-126). CONDITIONAL + optional.
 *
 * Only reached when city.tsx found ≥1 co-diner candidate. Candidates come from
 * the existing co_diners action verbatim: postAuthResume redeems a pending table
 * invite BEFORE onboarding renders, so by now the inviter + tablemates are
 * table_members rows and surface here (fn_co_diner_candidates' table union). No
 * new edge/SQL. NEVER forced — Continue and Skip both work at zero selections.
 *
 * Per-row follow is optimistic (useFollow owns its own snapshot→patch→rollback);
 * the card carries a local `followed` flag so the tap "does something" instantly.
 * Subtitle gate: a bare table co-member registers meals_together=1, which would
 * read as a false "1 meal together" — so we show the meta line only when >1.
 * Defensive: if this mounts with empty data (cold race past city's gate) it
 * self-advances to teach.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCoDiners } from '@/hooks/feed/useCoDiners';
import { useFollow } from '@/hooks/users/useFollow';
import { CoDinerFollowCard } from '@/components/feed/CoDinerFollowCard';
import { resolveEmptyState } from '@/components/feed/feedEmptyStateGate';
import { onboardingStyles as s } from './styles';

export default function OnboardingFollowsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { data: candidates, isFetched } = useCoDiners(user?.id);
    const follow = useFollow();

    // Local optimistic set — which cards were tapped. useFollow owns the cache
    // snapshots; this just flips the button label.
    const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());

    const resolution = resolveEmptyState(candidates);
    const cards = resolution.tier === 1 ? resolution.cards : [];

    // Safety net: reached with no candidates (race past city's branch) → teach.
    useEffect(() => {
        if (isFetched && cards.length === 0) {
            router.replace('/onboarding/teach');
        }
    }, [isFetched, cards.length, router]);

    const handleFollow = useCallback(
        (targetUserId: string) => {
            setFollowedIds((prev) => new Set(prev).add(targetUserId));
            follow.mutate(
                { targetUserId },
                {
                    onError: () => {
                        setFollowedIds((prev) => {
                            const next = new Set(prev);
                            next.delete(targetUserId);
                            return next;
                        });
                    },
                },
            );
        },
        [follow],
    );

    const goTeach = () => router.push('/onboarding/teach');

    return (
        <View style={[s.root, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[s.body, { paddingTop: insets.top + Spacing.xxl }]}>
                <Text style={[s.kicker, { color: palette.textMuted }]}>already here</Text>
                <Text style={[s.brandLine, { color: palette.text }]}>people you know</Text>

                <View style={styles.list}>
                    {cards.map((candidate) => (
                        <CoDinerFollowCard
                            key={candidate.user_id}
                            candidate={candidate}
                            followed={followedIds.has(candidate.user_id)}
                            onFollow={() => handleFollow(candidate.user_id)}
                            // Mid-onboarding we keep the loop closed — the row is a
                            // follow target, not a doorway out of the stack.
                            onOpenProfile={() => {}}
                            subtitle={candidate.meals_together > 1 ? undefined : null}
                        />
                    ))}
                </View>

                <Pressable onPress={goTeach} hitSlop={8} accessibilityRole="button">
                    <Text style={[s.skip, { color: palette.textMuted }]}>Skip</Text>
                </Pressable>
            </View>

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
                <Pressable
                    onPress={goTeach}
                    style={({ pressed }) => [
                        s.primaryBtn,
                        { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                >
                    <Text style={s.primaryBtnText}>Continue</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    list: {
        marginTop: Spacing.md,
    },
});
