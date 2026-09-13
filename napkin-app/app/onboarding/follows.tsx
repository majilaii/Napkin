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
import { Stack, useRouter } from 'expo-router';

import { Colors, Spacing, Type, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCoDiners } from '@/hooks/feed/useCoDiners';
import { useFollow } from '@/hooks/users/useFollow';
import { Avatar } from '@/components/feed/Avatar';
import { resolveEmptyState } from '@/components/feed/feedEmptyStateGate';
import { onboardingStyles as s } from './styles';
import { SetupFrame } from '@/components/onboarding/SetupFrame';
import { useFinishOnboarding } from '@/hooks/onboarding/useFinishOnboarding';

export default function OnboardingFollowsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
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
        <SetupFrame
            palette={palette}
            step={3}
            optional
            onBack={() => router.back()}
            backDisabled={isPending}
            footer={
                <>
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
                        accessibilityState={{ disabled: isPending, busy: isPending }}
                    >
                        {isPending ? <ActivityIndicator color={palette.textInverse} /> : (
                            <Text style={[s.primaryBtnText, { color: palette.textInverse }]}>
                                {completionError ? 'Try again' : 'Open Napkin'}
                            </Text>
                        )}
                    </Pressable>
                    <Pressable
                        onPress={finishOnboarding}
                        disabled={isPending}
                        style={s.skipButton}
                        accessibilityRole="button"
                        accessibilityLabel="Skip people suggestions"
                        accessibilityState={{ disabled: isPending }}
                    >
                        <Text style={[s.skip, { color: palette.textSecondary }]}>Maybe later</Text>
                    </Pressable>
                </>
            }
        >
            <Stack.Screen options={{ headerShown: false }} />
            <Text style={[s.heading, { color: palette.text }]}>Good taste, familiar faces.</Text>
            <Text style={[s.description, { color: palette.textSecondary }]}>
                Follow people you know to see where they’ve been eating.
            </Text>
            <View style={[styles.list, Shadow.note, { backgroundColor: palette.surfaceNote }]}>
                {cards.map((candidate) => {
                    const followed = followedIds.has(candidate.user_id);
                    return (
                        <View key={candidate.user_id} style={styles.person}>
                            <Avatar name={candidate.display_name} url={candidate.avatar_url} size={Spacing.xxl} palette={palette} />
                            <View style={styles.personText}>
                                <Text style={[styles.name, { color: palette.text }]}>{candidate.display_name}</Text>
                                {candidate.meals_together > 1 ? (
                                    <Text style={[styles.meta, { color: palette.textMuted }]}>
                                        {candidate.meals_together} meals together
                                    </Text>
                                ) : null}
                            </View>
                            <Pressable
                                onPress={() => handleFollow(candidate.user_id)}
                                disabled={followed || isPending}
                                accessibilityRole="button"
                                accessibilityLabel={`${followed ? 'Following' : 'Follow'} ${candidate.display_name}`}
                                accessibilityState={{ disabled: followed || isPending }}
                                style={({ pressed }) => [
                                    styles.followButton,
                                    { backgroundColor: followed ? palette.surfaceJournal : palette.primaryMuted, opacity: pressed ? 0.85 : 1 },
                                ]}
                            >
                                <Text style={[styles.followLabel, { color: followed ? palette.textSecondary : palette.primary }]}>
                                    {followed ? 'Following' : 'Follow'}
                                </Text>
                            </Pressable>
                        </View>
                    );
                })}
                {cards.length === 0 ? (
                    <Text style={[styles.meta, { color: palette.textSecondary }]}>
                        {isFetched ? 'You’re all set.' : 'Finding familiar faces…'}
                    </Text>
                ) : null}
            </View>
        </SetupFrame>
    );
}

const styles = StyleSheet.create({
    list: { padding: Spacing.md, borderRadius: Radius.xl, gap: Spacing.lg },
    person: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    personText: { flex: 1 },
    name: { ...Type.titleMedium },
    meta: { ...Type.metadata },
    followButton: {
        minHeight: Spacing.hitTarget,
        borderRadius: Radius.full,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        alignItems: 'center',
        justifyContent: 'center',
    },
    followLabel: { ...Type.metadata },
});
