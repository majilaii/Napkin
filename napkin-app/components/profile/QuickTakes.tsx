import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    LinearTransition,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { tintFor } from '@/lib/engraving';
import {
    quickTakePromptLabel,
    type ProfileQuickTake,
} from '@/lib/profileQuickTakes';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import { SectionHeader } from './SectionHeader';

type Props = {
    takes: ProfileQuickTake[];
    isOwner?: boolean;
    onEdit?: () => void;
};

type Palette = typeof Colors.light;

function RestaurantArt({ take, palette, isDark }: { take: ProfileQuickTake; palette: Palette; isDark: boolean }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [take.photo_url]);
    const showPhoto = !!take.photo_url && !failed;

    return (
        <View
            style={[
                styles.art,
                {
                    backgroundColor: tintFor(take.restaurant_id, palette),
                    borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
                },
            ]}
        >
            {showPhoto ? (
                <>
                    <Image
                        source={{ uri: take.photo_url! }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={160}
                        onError={() => setFailed(true)}
                    />
                    <View
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                backgroundColor: palette.placesOverlayTint,
                                opacity: palette.placesOverlayOpacity,
                            },
                        ]}
                        pointerEvents="none"
                    />
                </>
            ) : (
                <Text style={[styles.monogram, { color: palette.primary }]}>
                    {(take.name.trim()[0] ?? '·').toUpperCase()}
                </Text>
            )}
        </View>
    );
}

function QuickTakeRow({
    take,
    open,
    onToggle,
    palette,
    isDark,
    isLast,
}: {
    take: ProfileQuickTake;
    open: boolean;
    onToggle: () => void;
    palette: Palette;
    isDark: boolean;
    isLast: boolean;
}) {
    const rotation = useSharedValue(open ? 1 : 0);
    const mounted = useRef(false);
    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true;
            rotation.value = open ? 1 : 0;
            return;
        }
        rotation.value = withTiming(open ? 1 : 0, { duration: 210 });
    }, [open, rotation]);
    const chevronStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${rotation.value * 180}deg` }],
    }));
    const prompt = quickTakePromptLabel(take.prompt_key);
    const meta = [take.city, take.cuisine].filter(Boolean).join(' · ');
    const accessibilityLabel = [
        `${prompt}: ${take.name}`,
        meta || null,
        open && take.note ? `Note: ${take.note}` : null,
    ].filter(Boolean).join('. ');

    return (
        <Animated.View
            layout={LinearTransition.duration(230)}
            style={!isLast ? [styles.rule, { borderBottomColor: palette.dividerSoft }] : undefined}
        >
            <Pressable
                onPress={onToggle}
                style={({ pressed }) => [
                    open ? styles.detail : styles.summary,
                    open ? { backgroundColor: palette.surfaceJournalLow } : null,
                    pressed ? { opacity: 0.78 } : null,
                ]}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={accessibilityLabel}
                accessibilityHint={open ? 'Collapses this take' : 'Expands this take'}
            >
                {open ? (
                    <>
                        <View style={styles.detailCopy}>
                            <Text style={[Type.sectionKicker, { color: palette.primary }]}>
                                {prompt}
                            </Text>
                            <Text style={[styles.detailName, { color: palette.text }]} numberOfLines={3}>
                                {take.name}
                            </Text>
                            {meta ? (
                                <Text style={[Type.metadata, { color: palette.textMuted }]} numberOfLines={2}>
                                    {meta}
                                </Text>
                            ) : null}
                            {take.note ? (
                                <Text style={[styles.note, { color: palette.textSecondary }]}>
                                    {`— ${take.note}`}
                                </Text>
                            ) : null}
                        </View>
                        <RestaurantArt take={take} palette={palette} isDark={isDark} />
                        <Animated.View style={[styles.detailChevron, chevronStyle]}>
                            <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
                        </Animated.View>
                    </>
                ) : (
                    <>
                        <Text style={[Type.sectionKicker, styles.prompt, { color: palette.primary }]} numberOfLines={2}>
                            {prompt}
                        </Text>
                        <Text style={[Type.editorialBody, styles.answer, { color: palette.text }]} numberOfLines={1}>
                            {take.name}
                        </Text>
                        <Animated.View style={chevronStyle}>
                            <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
                        </Animated.View>
                    </>
                )}
            </Pressable>
        </Animated.View>
    );
}

export function QuickTakes({ takes, isOwner = false, onEdit }: Props) {
    const scheme = (useColorScheme() ?? 'light') as keyof typeof Colors;
    const palette = Colors[scheme] as Palette;
    const [openKey, setOpenKey] = useState<string | null>(takes[0]?.prompt_key ?? null);

    useEffect(() => {
        setOpenKey((current) => {
            if (takes.length === 0) return null;
            return takes.some((take) => take.prompt_key === current)
                ? current
                : takes[0].prompt_key;
        });
    }, [takes]);

    if (takes.length === 0 && !isOwner) return null;

    return (
        <View>
            <SectionHeader
                title="Quick takes"
                rightLabel={isOwner && onEdit ? 'edit' : undefined}
                onRightLabelPress={onEdit}
            />
            {takes.length > 0 ? (
                <View style={[styles.deck, { backgroundColor: palette.card }, Shadow.ambient]}>
                    {takes.map((take, index) => (
                        <QuickTakeRow
                            key={take.prompt_key}
                            take={take}
                            open={openKey === take.prompt_key}
                            onToggle={() =>
                                setOpenKey((current) => (current === take.prompt_key ? null : take.prompt_key))
                            }
                            palette={palette}
                            isDark={scheme === 'dark'}
                            isLast={index === takes.length - 1}
                        />
                    ))}
                </View>
            ) : (
                <PressableScale
                    onPress={onEdit}
                    scaleTo={0.96}
                    style={[
                        styles.empty,
                        {
                            backgroundColor: palette.terracottaScrim,
                            borderColor: palette.terracottaBorderStrong,
                        },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Add a quick take"
                >
                    <Ionicons name="add" size={20} color={palette.primary} />
                    <Text style={[Type.body, styles.emptyLabel, { color: palette.primary }]}>add a take</Text>
                </PressableScale>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    deck: {
        marginHorizontal: Spacing.lg,
        borderRadius: Radius.lg,
        overflow: 'hidden',
    },
    rule: { borderBottomWidth: StyleSheet.hairlineWidth },
    summary: {
        minHeight: 68,
        paddingHorizontal: Spacing.md,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    prompt: { width: 112 },
    answer: { flex: 1, minWidth: 0 },
    detail: {
        minHeight: 164,
        margin: 4,
        paddingLeft: 14,
        paddingRight: 12,
        paddingVertical: 14,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: 14,
    },
    detailCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
    detailName: {
        ...Type.editorialTitle,
        marginTop: 7,
        marginBottom: 3,
    },
    note: {
        ...Type.quote,
        marginTop: 10,
    },
    art: {
        width: 108,
        minHeight: 136,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    monogram: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 36,
        lineHeight: 42,
    },
    detailChevron: { position: 'absolute', top: 10, right: 10 },
    empty: {
        minHeight: 52,
        marginHorizontal: Spacing.lg,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderRadius: Radius.lg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
    },
    emptyLabel: { fontFamily: 'Manrope_600SemiBold' },
});
