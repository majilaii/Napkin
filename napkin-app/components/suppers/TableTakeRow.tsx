/**
 * TableTakeRow — one accordion row in the Supper "at the table" list (TICKET-082).
 *
 * Collapsed: avatar · name + em-dash one-line take preview (Newsreader italic 15,
 * 1 line ellipsized) · small amber-cream rating chip · chevron. Tapping toggles
 * the parent's openId; expanding reveals <ExpandedTake> in place.
 *
 * A roster member with NO take = a "pending" ghost row ("hasn't added their
 * take", reduced opacity, non-expandable, no chip, no chevron).
 *
 * Animation (per spec):
 *   - The whole row is an Animated.View with layout={LinearTransition.duration(220)}
 *     so siblings reflow smoothly as one expands.
 *   - The expanded body uses entering={FadeIn} / exiting={FadeOut}.
 *   - The chevron rotates via useAnimatedStyle + withTiming (TIMING, not spring).
 *   - overflow:'hidden' on the row container clips the body during the transition.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    FadeIn,
    FadeOut,
    LinearTransition,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import type { SupperRosterMember, SupperTake } from '@/hooks/suppers';
import { InitialsAvatar } from './InitialsAvatar';
import { ExpandedTake } from './ExpandedTake';

type Palette = typeof Colors.light;

interface TableTakeRowProps {
    member: SupperRosterMember;
    take?: SupperTake;
    open: boolean;
    onToggle: () => void;
    palette: Palette;
}

export function TableTakeRow({ member, take, open, onToggle, palette }: TableTakeRowProps) {
    const isPending = !take;
    const name = member.display_name ?? 'Someone';

    // Chevron rotation — TIMING, not spring.
    const rotation = useSharedValue(open ? 1 : 0);
    React.useEffect(() => {
        rotation.value = withTiming(open ? 1 : 0, { duration: 200 });
    }, [open, rotation]);
    const chevronStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${rotation.value * 90}deg` }],
    }));

    // Collapsed preview: prefer the note, fall back to the dish.
    const preview = take?.content?.trim() || take?.dish_description?.trim() || null;

    return (
        <Animated.View
            layout={LinearTransition.duration(220)}
            style={[styles.row, isPending && styles.pendingRow]}
        >
            <Pressable
                onPress={isPending ? undefined : onToggle}
                disabled={isPending}
                style={styles.head}
                accessibilityRole={isPending ? undefined : 'button'}
                accessibilityState={isPending ? undefined : { expanded: open }}
                accessibilityLabel={
                    isPending ? `${name} hasn't added their take` : `${name}'s take`
                }
            >
                <InitialsAvatar
                    name={name}
                    avatarUrl={member.avatar_url}
                    size={32}
                    palette={palette}
                />

                <View style={styles.body}>
                    <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                        {name}
                    </Text>
                    {isPending ? (
                        <Text style={[styles.pendingLine, { color: palette.textMuted }]} numberOfLines={1}>
                            hasn&apos;t added their take
                        </Text>
                    ) : preview ? (
                        <Text style={[styles.preview, { color: palette.textSecondary }]} numberOfLines={1}>
                            {'—  '}
                            {preview}
                        </Text>
                    ) : (
                        <Text style={[styles.preview, { color: palette.textMuted }]} numberOfLines={1}>
                            {'—  just the score'}
                        </Text>
                    )}
                </View>

                {/* Rating chip — amber numeral on amber-cream. Only for submitted takes. */}
                {!isPending && take?.rating != null ? (
                    <View style={[styles.ratingChip, { backgroundColor: palette.tertiaryFixed }]}>
                        <Text style={[styles.ratingChipNum, { color: palette.tertiary }]}>
                            {take.rating.toFixed(1)}
                        </Text>
                    </View>
                ) : null}

                {/* Chevron — hidden on pending rows. */}
                {!isPending ? (
                    <Animated.View style={chevronStyle}>
                        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                    </Animated.View>
                ) : null}
            </Pressable>

            {/* Expanded body — fades in/out; clipped by overflow:hidden on the row. */}
            {open && take ? (
                <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)}>
                    <ExpandedTake take={take} palette={palette} />
                </Animated.View>
            ) : null}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    row: {
        overflow: 'hidden',
        paddingVertical: 10,
    },
    pendingRow: {
        opacity: 0.5,
    },
    head: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
    },
    body: {
        flex: 1,
        gap: 2,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 20,
    },
    preview: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 20,
    },
    pendingLine: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        lineHeight: 16,
    },
    ratingChip: {
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 999,
        minWidth: 34,
        alignItems: 'center',
    },
    ratingChipNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
    },
});
