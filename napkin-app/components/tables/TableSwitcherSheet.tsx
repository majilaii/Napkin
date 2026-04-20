/**
 * TableSwitcherSheet — bottom sheet for table selection.
 *
 * Replaces the top-dropdown Modal from tables.tsx.
 * Canvas: WF7 "Table switcher sheet" — all tables as rows,
 * solo journal as a distinct row, live-pulse dot on active rounds.
 *
 * Implementation uses RN Modal + Animated.spring (no @gorhom/bottom-sheet dep).
 * Drag handle + dim backdrop + spring slide-up/dismiss.
 */

import React, { useEffect, useRef } from 'react';
import {
    View,
    Text,
    Pressable,
    Modal,
    Animated,
    StyleSheet,
    PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { PulseDot } from '@/components/feed/PulseDot';
import { Avatar } from '@/components/feed/Avatar';
import type { TableMembership } from '@/hooks/tables/useTables';

type Palette = typeof Colors.light;

interface TableSwitcherSheetProps {
    tables: TableMembership[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    visible: boolean;
    onClose: () => void;
    palette: Palette;
    /** IDs of tables with a currently live round (status === 'rating') */
    liveRoundTableIds?: Set<string>;
    /** "Gather new" CTA — stub when no create-table flow exists */
    onGatherNew?: () => void;
}

const DRAG_DISMISS_THRESHOLD = 80;
const SHEET_HEIGHT = 380;

export function TableSwitcherSheet({
    tables,
    selectedIndex,
    onSelect,
    visible,
    onClose,
    palette,
    liveRoundTableIds,
    onGatherNew,
}: TableSwitcherSheetProps) {
    const insets = useSafeAreaInsets();
    const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
    const dragY = useRef(new Animated.Value(0)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    // Open / close animation
    useEffect(() => {
        if (visible) {
            dragY.setValue(0);
            Animated.parallel([
                Animated.spring(translateY, {
                    toValue: 0,
                    useNativeDriver: true,
                    damping: 22,
                    stiffness: 220,
                }),
                Animated.timing(backdropOpacity, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.spring(translateY, {
                    toValue: SHEET_HEIGHT,
                    useNativeDriver: true,
                    damping: 30,
                    stiffness: 300,
                }),
                Animated.timing(backdropOpacity, {
                    toValue: 0,
                    duration: 160,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible, translateY, dragY, backdropOpacity]);

    // Pan responder for drag-to-dismiss
    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gestureState) =>
                Math.abs(gestureState.dy) > 6,
            onPanResponderMove: (_, gestureState) => {
                if (gestureState.dy > 0) {
                    dragY.setValue(gestureState.dy);
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dy > DRAG_DISMISS_THRESHOLD || gestureState.vy > 0.8) {
                    onClose();
                } else {
                    Animated.spring(dragY, {
                        toValue: 0,
                        useNativeDriver: true,
                        damping: 22,
                        stiffness: 200,
                    }).start();
                }
            },
        })
    ).current;

    const sheetTranslate = Animated.add(translateY, dragY);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            {/* Backdrop */}
            <Animated.View
                style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}
            >
                <Pressable
                    style={[StyleSheet.absoluteFill, styles.backdrop]}
                    onPress={onClose}
                    accessibilityLabel="Close table switcher"
                />
            </Animated.View>

            {/* Sheet */}
            <Animated.View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        paddingBottom: insets.bottom + Spacing.md,
                        transform: [{ translateY: sheetTranslate }],
                    },
                ]}
            >
                {/* Drag handle */}
                <View {...panResponder.panHandlers} style={styles.handleArea}>
                    <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />
                </View>

                {/* Sheet title + "Gather new" CTA */}
                <View style={styles.titleRow}>
                    <Text style={[styles.sheetTitle, { color: palette.text }]}>
                        Your tables
                    </Text>
                    {onGatherNew && (
                        <Pressable
                            onPress={onGatherNew}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="Gather a new table"
                        >
                            <Text style={[styles.gatherCta, { color: palette.primary }]}>
                                + GATHER NEW
                            </Text>
                        </Pressable>
                    )}
                </View>

                {/* Table rows */}
                {tables.map((t, i) => {
                    const tbl = t.tables;
                    if (!tbl) return null;
                    const isActive = i === selectedIndex;
                    const hasLiveRound = liveRoundTableIds?.has(tbl.id) ?? false;

                    return (
                        <TableRow
                            key={tbl.id}
                            tableName={tbl.name}
                            isPersonal={tbl.is_personal ?? false}
                            isActive={isActive}
                            hasLiveRound={hasLiveRound}
                            palette={palette}
                            onPress={() => {
                                onSelect(i);
                                onClose();
                            }}
                        />
                    );
                })}
            </Animated.View>
        </Modal>
    );
}

// ── TableRow ───────────────────────────────────────────────────────────────

interface TableRowProps {
    tableName: string;
    isPersonal: boolean;
    isActive: boolean;
    hasLiveRound: boolean;
    palette: Palette;
    onPress: () => void;
}

function TableRow({
    tableName,
    isPersonal,
    isActive,
    hasLiveRound,
    palette,
    onPress,
}: TableRowProps) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                {
                    backgroundColor: isActive
                        ? palette.primaryMuted
                        : pressed
                        ? palette.surfaceContainerHigh
                        : 'transparent',
                },
            ]}
            accessibilityRole="button"
            accessibilityLabel={tableName}
            accessibilityState={{ selected: isActive }}
        >
            {/* Avatar stack — canvas shows up to 3 overlapping member avatars per row.
                Table-management edge function doesn't surface member profiles in the
                list endpoint, so we approximate with a single table-initials avatar
                plus two muted companion discs for the silhouette density. */}
            <View style={styles.avatarStack}>
                {!isPersonal && (
                    <>
                        <View
                            style={[
                                styles.stackDisc,
                                styles.stackDiscBack,
                                { backgroundColor: palette.outlineVariant, borderColor: palette.surfaceContainerLow },
                            ]}
                        />
                        <View
                            style={[
                                styles.stackDisc,
                                styles.stackDiscMid,
                                { backgroundColor: palette.primaryMuted, borderColor: palette.surfaceContainerLow },
                            ]}
                        />
                    </>
                )}
                <View
                    style={[
                        styles.stackDisc,
                        styles.stackDiscFront,
                        !isPersonal && styles.stackDiscFrontOffset,
                        { borderColor: palette.surfaceContainerLow },
                    ]}
                >
                    <Avatar name={tableName} url={null} size={26} palette={palette} />
                </View>
            </View>

            {/* Name + sub */}
            <View style={styles.rowText}>
                <Text
                    style={[
                        isPersonal ? styles.rowNameSans : styles.rowNameSerif,
                        { color: isActive ? palette.primary : palette.text },
                    ]}
                    numberOfLines={1}
                >
                    {isPersonal ? 'Your journal' : tableName}
                </Text>
                <Text style={[styles.rowSub, { color: palette.textMuted }]}>
                    {isPersonal ? 'Solo' : 'Shared table'}
                </Text>
            </View>

            {/* Live round pulse dot */}
            {hasLiveRound && (
                <View style={styles.rowRight}>
                    <PulseDot size={7} color={palette.primary} />
                    <Text style={[styles.liveLabel, { color: palette.primary }]}>
                        live
                    </Text>
                </View>
            )}

            {/* Active check */}
            {isActive && !hasLiveRound && (
                <Text style={{ color: palette.primary, fontSize: 16, marginLeft: Spacing.sm }}>
                    ✓
                </Text>
            )}
        </Pressable>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    backdrop: {
        backgroundColor: 'rgba(28, 28, 25, 0.4)',
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        // Ambient shadow upward
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 16,
        minHeight: SHEET_HEIGHT,
    },
    handleArea: {
        alignItems: 'center',
        paddingVertical: Spacing.md,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm + 4,
    },
    sheetTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        letterSpacing: -0.3,
    },
    gatherCta: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 0.8,
    },
    avatarStack: {
        width: 54,
        height: 28,
        flexDirection: 'row',
        alignItems: 'center',
    },
    stackDisc: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 2,
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
    },
    stackDiscBack: {
        left: 0,
    },
    stackDiscMid: {
        left: 9,
    },
    stackDiscFront: {
        left: 0,
    },
    stackDiscFrontOffset: {
        left: 18,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        gap: Spacing.md,
    },
    rowText: {
        flex: 1,
    },
    rowNameSerif: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        lineHeight: 22,
    },
    rowNameSans: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 15,
    },
    rowSub: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        marginTop: 1,
    },
    rowRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    liveLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
});
