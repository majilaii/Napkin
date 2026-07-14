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
    onOpenRestaurant: (restaurantId: string) => void;
};

type Palette = typeof Colors.light;

function RestaurantArt({
    take,
    palette,
    onPress,
}: {
    take: ProfileQuickTake;
    palette: Palette;
    onPress: () => void;
}) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [take.photo_url]);
    const showPhoto = !!take.photo_url && !failed;

    return (
        <PressableScale
            onPress={onPress}
            scaleTo={0.96}
            style={[
                styles.art,
                {
                    backgroundColor: tintFor(take.restaurant_id, palette),
                    borderColor: palette.imageOutline,
                },
            ]}
            accessibilityRole="link"
            accessibilityLabel={`Open ${take.name} restaurant page`}
            accessibilityHint="Shows the restaurant’s details"
        >
            {showPhoto ? (
                <>
                    <Image
                        source={{ uri: take.photo_url! }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={160}
                        onError={() => setFailed(true)}
                        accessible={false}
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
                <Text style={[styles.monogram, { color: palette.primary }]} accessible={false}>
                    {(take.name.trim()[0] ?? '·').toUpperCase()}
                </Text>
            )}
        </PressableScale>
    );
}

function QuickTakeRow({
    take,
    open,
    onToggle,
    onOpenRestaurant,
    palette,
    isLast,
}: {
    take: ProfileQuickTake;
    open: boolean;
    onToggle: () => void;
    onOpenRestaurant: () => void;
    palette: Palette;
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
            {open ? (
                <View
                    style={[styles.detail, { backgroundColor: palette.surfaceJournalLow }]}
                    testID="quick-take-detail"
                >
                    <View style={styles.detailHeader} testID="quick-take-detail-header">
                        <Text
                            style={[Type.sectionKicker, styles.detailPrompt, { color: palette.primary }]}
                            numberOfLines={2}
                        >
                            {prompt}
                        </Text>
                        <RestaurantArt take={take} palette={palette} onPress={onOpenRestaurant} />
                        <PressableScale
                            onPress={onToggle}
                            scaleTo={0.96}
                            style={styles.collapseButton}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: true }}
                            accessibilityLabel={`Collapse ${prompt}: ${take.name}`}
                            accessibilityHint="Collapses this take"
                            testID="quick-take-collapse-control"
                        >
                            <Animated.View style={chevronStyle}>
                                <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
                            </Animated.View>
                        </PressableScale>
                    </View>
                    <View style={styles.detailBody} testID="quick-take-detail-body">
                        <Text style={[styles.detailName, { color: palette.text }]} numberOfLines={3}>
                            {take.name}
                        </Text>
                        {meta ? (
                            <Text
                                style={[Type.metadata, styles.detailMeta, { color: palette.textMuted }]}
                                numberOfLines={2}
                            >
                                {meta}
                            </Text>
                        ) : null}
                        {take.note ? (
                            <Text style={[styles.note, { color: palette.textSecondary }]}>
                                {`— ${take.note}`}
                            </Text>
                        ) : null}
                    </View>
                </View>
            ) : (
                <Pressable
                    onPress={onToggle}
                    style={({ pressed }) => [styles.summary, pressed ? styles.copyPressed : null]}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: false }}
                    accessibilityLabel={accessibilityLabel}
                    accessibilityHint="Expands this take"
                >
                    <Text style={[Type.sectionKicker, styles.prompt, { color: palette.primary }]} numberOfLines={2}>
                        {prompt}
                    </Text>
                    <Text style={[Type.editorialBody, styles.answer, { color: palette.text }]} numberOfLines={1}>
                        {take.name}
                    </Text>
                    <Animated.View style={chevronStyle}>
                        <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
                    </Animated.View>
                </Pressable>
            )}
        </Animated.View>
    );
}

export function QuickTakes({ takes, isOwner = false, onEdit, onOpenRestaurant }: Props) {
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
                            onOpenRestaurant={() => onOpenRestaurant(take.restaurant_id)}
                            palette={palette}
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
        margin: 4,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 12,
        gap: 10,
    },
    detailHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    detailPrompt: { flex: 1, minWidth: 0 },
    detailBody: { minWidth: 0 },
    copyPressed: { opacity: 0.78 },
    collapseButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    detailName: {
        ...Type.editorialTitle,
    },
    detailMeta: {
        marginTop: 3,
    },
    note: {
        ...Type.quote,
        marginTop: 8,
    },
    art: {
        width: 44,
        height: 44,
        borderRadius: 10,
        borderWidth: 1,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    monogram: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 18,
        lineHeight: 22,
    },
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
