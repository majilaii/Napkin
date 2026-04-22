/**
 * RegularsRail — horizontal scrolling rail of regular restaurant cards.
 * TICKET-025
 *
 * 138px-wide cards with ×N visit count pill in terracotta.
 * Cold-start: locked panel nudge.
 * "SEE ALL" label taps to /regulars full-screen.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SectionHeader } from './SectionHeader';
import type { RegularSummary } from '@/hooks/users/useUserProfile';

interface Props {
    regulars: RegularSummary[];
    userId: string;
    /** True to show "SEE ALL" link to /regulars. Phase 1: self only. */
    showSeeAll?: boolean;
}

export function RegularsRail({ regulars, userId, showSeeAll = false }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const isEmpty = regulars.length === 0;
    const canSeeAll = showSeeAll && !isEmpty;

    return (
        <View style={{ marginTop: Spacing.md }}>
            <SectionHeader
                title="Your regulars"
                rightLabel={canSeeAll ? 'SEE ALL' : undefined}
                onRightLabelPress={canSeeAll ? () => router.push(`/regulars?userId=${userId}`) : undefined}
            />
            {isEmpty ? (
                <View style={[styles.lockedPanel, { backgroundColor: palette.surfaceContainerLow, borderColor: palette.outlineVariant }]}>
                    <Text
                        style={[
                            Type.headlineItalic,
                            { color: palette.text, fontSize: 14, fontFamily: 'Newsreader_400Regular_Italic', textAlign: 'center' },
                        ]}
                    >
                        Regulars unlock after your third visit.
                    </Text>
                    <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: Spacing.xs, textAlign: 'center', lineHeight: 18 }]}>
                        Log a place three times and it earns a home here.
                    </Text>
                </View>
            ) : (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.scrollContent}
                >
                    {regulars.map((r) => (
                        <RegularCard key={r.restaurant_id} regular={r} palette={palette} />
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

function RegularCard({ regular, palette }: { regular: RegularSummary; palette: any }) {
    const formatLastVisit = (ts: string | null): string => {
        if (!ts) return '';
        const d = new Date(ts);
        return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    };

    return (
        <View style={[styles.card, { backgroundColor: palette.surfaceContainerLow, borderColor: palette.outlineVariant }]}>
            {/* Photo area */}
            <View style={[styles.cardPhoto, { backgroundColor: palette.surfaceContainerHigh }]}>
                {regular.photo_url ? (
                    <Image
                        source={{ uri: regular.photo_url }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={150}
                    />
                ) : null}
                {/* Visit count pill — top right */}
                <View style={[styles.visitPill, { backgroundColor: palette.primary }]}>
                    <Text style={styles.visitPillText}>
                        ×{regular.visit_count}
                    </Text>
                </View>
            </View>
            <View style={styles.cardBody}>
                <Text
                    style={{
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 13,
                        color: palette.text,
                        lineHeight: 16,
                    }}
                    numberOfLines={1}
                >
                    {regular.name}
                </Text>
                {regular.city && (
                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: 3, fontSize: 10 }]} numberOfLines={1}>
                        {regular.city}
                    </Text>
                )}
                {regular.last_visited_at && (
                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: 2, fontSize: 10 }]}>
                        {'last · '}{formatLastVisit(regular.last_visited_at)}
                    </Text>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    scrollContent: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: 4,
        gap: 10,
    },
    card: {
        width: 138,
        flexShrink: 0,
        borderRadius: Radius.sm,
        overflow: 'hidden',
        borderWidth: 1,
    },
    cardPhoto: {
        height: 72,
        position: 'relative',
    },
    visitPill: {
        position: 'absolute',
        top: 6,
        right: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 3,
    },
    visitPillText: {
        color: Colors.light.textInverse,
        fontSize: 9,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
    cardBody: {
        padding: 10,
        paddingTop: 8,
    },
    lockedPanel: {
        marginHorizontal: Spacing.lg,
        paddingVertical: Spacing.lg,
        paddingHorizontal: Spacing.md,
        borderRadius: Radius.sm,
        borderWidth: 1,
        alignItems: 'center',
    },
});
