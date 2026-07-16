/**
 * Onboarding S4 — Follow suggestions (TICKET-126). CONDITIONAL + optional.
 *
 * Only reached when city.tsx found ≥1 co-diner candidate. Candidates come from
 * the existing co_diners action verbatim: postAuthResume redeems a pending table
 * invite BEFORE onboarding renders, so by now the inviter + tablemates are
 * table_members rows and surface here (fn_co_diner_candidates' table union). No
 * new edge/SQL. NEVER forced — Done and Skip both work at zero selections.
 *
 * Per-row follow is optimistic (useFollow owns its own snapshot→patch→rollback);
 * the card carries a local `followed` flag so the tap "does something" instantly.
 * Subtitle gate: a bare table co-member registers meals_together=1, which would
 * read as a false "1 meal together" — so we show the meta line only when >1.
 * Defensive: if this initially resolves with empty data (cold race past city's
 * gate) it completes onboarding once without waiting for another tap.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCoDiners } from '@/hooks/feed/useCoDiners';
import { useFollow } from '@/hooks/users/useFollow';
import { CoDinerFollowCard } from '@/components/feed/CoDinerFollowCard';
import { resolveEmptyState } from '@/components/feed/feedEmptyStateGate';
import { onboardingStyles as s } from './styles';
import { useFinishOnboarding } from '@/hooks/onboarding/useFinishOnboarding';

export default function OnboardingFollowsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const { data: candidates, isFetched } = useCoDiners(user?.id);
    const follow = useFollow();
    const { finish, isPending, completionError } = useFinishOnboarding();
    const sawCandidates = useRef(false);
    const didAutoFinish = useRef(false);

    // Local optimistic set — which cards were tapped. useFollow owns the cache
    // snapshots; this just flips the button label.
    const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());

    const resolution = resolveEmptyState(candidates);
    const cards = resolution.tier === 1 ? resolution.cards : [];

    // Safety net: initially reached with no candidates (race past city's branch)
    // → finish. Once cards have rendered, an optimistic follow may remove the
    // final one; that must wait for Done/Skip so a follow failure stays visible.
    // Run once so a failed completion also stays available for an explicit retry.
    useEffect(() => {
        if (cards.length > 0) {
            sawCandidates.current = true;
            return;
        }
        if (
            isFetched &&
            !sawCandidates.current &&
            !didAutoFinish.current
        ) {
            didAutoFinish.current = true;
            finish();
        }
    }, [isFetched, cards.length, finish]);

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

    const finishOnboarding = useCallback(() => finish(), [finish]);

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

                <Pressable
                    onPress={finishOnboarding}
                    disabled={isPending}
                    hitSlop={8}
                    accessibilityRole="button"
                >
                    <Text style={[s.skip, { color: palette.textMuted }]}>Skip</Text>
                </Pressable>
            </View>

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
                {completionError ? (
                    <Text
                        accessible
                        accessibilityRole="alert"
                        accessibilityLiveRegion="polite"
                        style={[s.completionError, { color: palette.error }]}
                    >
                        {completionError}
                    </Text>
                ) : null}
                <Pressable
                    onPress={finishOnboarding}
                    disabled={isPending}
                    style={({ pressed }) => [
                        s.primaryBtn,
                        { backgroundColor: palette.primary, opacity: isPending ? 0.6 : pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                >
                    {isPending ? (
                        <ActivityIndicator color={palette.textInverse} />
                    ) : (
                        <Text style={s.primaryBtnText}>
                            {completionError ? 'Try again' : 'Done'}
                        </Text>
                    )}
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
