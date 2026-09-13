import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useDiscoveryGuide } from '@/hooks/onboarding/useDiscoveryGuide';
import { dismissDiscoveryTip, type DiscoveryTopic } from '@/lib/discoveryGuide';
import { findGuideChapter } from './guideContent';

const tips: Record<DiscoveryTopic, { title: string; body: string }> = {
    places: { title: 'Keep a place for later', body: 'Tap a restaurant’s heart to pin it. Your clips land here too.' },
    journal: { title: 'Your meals, remembered', body: 'Check in or write a review from a restaurant page.' },
    tables: { title: 'Where your tastes meet', body: 'On the map brings together places your Table wants to try.' },
    friends: { title: 'Bring your people into the Feed', body: 'Follow someone to see their meals and finds here.' },
    lists: { title: 'Give your places a collection', body: 'Make a list for a trip, a neighbourhood, or a favourite kind of meal.' },
};

/** Opted-in first-run education, scoped to the viewer and dismissible for good. */
export function DiscoveryTip({ topic }: { topic: DiscoveryTopic }) {
    const { user } = useAuth();
    const guide = useDiscoveryGuide(user?.id);
    const router = useRouter();
    const palette = Colors[useColorScheme() ?? 'light'];
    if (!user?.id || !guide.ready || !guide.enabled || guide.dismissed.includes(topic)) return null;
    const chapter = findGuideChapter(topic)!;
    const tip = tips[topic];
    return (
        <View testID={`discovery-tip-${topic}`} style={[s.card, { backgroundColor: palette.surfaceJournal }]}>
            <View style={s.row}>
                <Text style={[Type.sectionKicker, s.flex, { color: palette.primary }]}>A little introduction</Text>
                <Pressable onPress={() => { void dismissDiscoveryTip(user.id, topic); }} style={s.close} accessibilityRole="button" accessibilityLabel={`Dismiss ${chapter.label} tip`}>
                    <Ionicons name="close-outline" size={20} color={palette.textMuted} />
                </Pressable>
            </View>
            <Text style={[Type.editorialTitle, { color: palette.text }]}>{tip.title}</Text>
            <Text style={[Type.body, s.body, { color: palette.textSecondary }]}>{tip.body}</Text>
            <Pressable onPress={() => router.push({ pathname: '/welcome', params: { topic } })} style={s.learn} accessibilityRole="button" accessibilityLabel={`Learn about ${chapter.label}`}>
                <Text style={[Type.metadata, { color: palette.primary }]}>See how</Text>
                <Ionicons name="arrow-forward-outline" size={16} color={palette.primary} />
            </Pressable>
        </View>
    );
}

const s = StyleSheet.create({
    card: { marginHorizontal: Spacing.lg, marginBottom: Spacing.lg, padding: Spacing.md, borderRadius: Radius.lg },
    row: { flexDirection: 'row', alignItems: 'center' },
    flex: { flex: 1 },
    close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: -Spacing.sm, marginRight: -Spacing.sm },
    body: { marginTop: Spacing.xs },
    learn: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
});
