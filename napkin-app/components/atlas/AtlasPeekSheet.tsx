/**
 * AtlasPeekSheet — bottom sheet that rises when a map pin is tapped.
 *
 * Shows the full visit history at one restaurant:
 *   - Round visits:  "4 of us — Clara · Thomas · Julian · you"  + avg rating + date
 *   - Solo visits:   "[Name]" + their rating + date
 *
 * Tapping a visit row navigates to:
 *   - Round → /table-night-detail?nightId=<table_night_id>
 *   - Solo  → /entry-detail?entryId=<entry_id>
 *
 * Implementation: Modal + Animated.spring — identical pattern to AddMemberSheet
 * and TableSwitcherSheet. No new bottom-sheet library.
 *
 * Sheet header: italic Newsreader restaurant name, secondary line with
 * "city · cuisine", heart glyph if wished_by_viewer. Close button top-right.
 * Max height ~60% of screen.
 */

import React, { useRef, useEffect } from 'react';
import {
    View,
    Text,
    Modal,
    Animated,
    PanResponder,
    ScrollView,
    Pressable,
    StyleSheet,
    Image,
    Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PressableScale } from '@/components/ui/napkin';
import type { AtlasRestaurantTile, AtlasVisitRow } from '@/hooks/tables/useTableAtlasCity';

const DRAG_DISMISS_THRESHOLD = 80;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_MAX_HEIGHT = Math.round(SCREEN_HEIGHT * 0.62);

// ── Date formatting ───────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
    if (!iso) return 'no date';
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

// ── Participant label for Round visits ────────────────────────────────────────

function buildRoundWho(
    visit: Extract<AtlasVisitRow, { kind: 'round' }>,
    currentUserId: string,
): string {
    const participants = visit.round_participants;
    if (!participants || participants.length === 0) {
        return `${visit.display_name}`;
    }
    // Sort current user to end so label reads "Clara · Thomas · you"
    const sorted = [...participants].sort((a, b) => {
        const aIsMe = a.user_id === currentUserId ? 1 : 0;
        const bIsMe = b.user_id === currentUserId ? 1 : 0;
        return aIsMe - bIsMe;
    });
    const names = sorted.map((p) =>
        p.user_id === currentUserId ? 'you' : p.display_name,
    );
    const count = names.length;
    if (count <= 3) {
        return `${count} of us — ${names.join(' · ')}`;
    }
    return `${count} of us — ${names.slice(0, 3).join(' · ')} · …`;
}

// ── VisitRow ──────────────────────────────────────────────────────────────────

interface VisitRowProps {
    visit: AtlasVisitRow;
    currentUserId: string;
    palette: typeof Colors.light;
    onPress: () => void;
}

function VisitRow({ visit, currentUserId, palette, onPress }: VisitRowProps) {
    const isRound = visit.kind === 'round';

    const who =
        isRound
            ? buildRoundWho(visit as Extract<AtlasVisitRow, { kind: 'round' }>, currentUserId)
            : visit.user_id === currentUserId
            ? 'you'
            : visit.display_name;

    const ratingStr = visit.rating != null ? `${visit.rating}` : '—';
    const dateStr = formatDate(visit.date);

    return (
        <PressableScale onPress={onPress} haptic="selection" scaleTo={0.98}>
            <View style={[styles.visitRow, { borderBottomColor: palette.dividerSoft }]}>
                {/* Avatar */}
                <View style={[styles.avatarCircle, { backgroundColor: palette.primaryContainer }]}>
                    {visit.avatar_url ? (
                        <Image
                            source={{ uri: visit.avatar_url }}
                            style={styles.avatarImg}
                        />
                    ) : (
                        <Text style={[styles.avatarInitial, { color: palette.background }]}>
                            {visit.display_name.slice(0, 1).toUpperCase()}
                        </Text>
                    )}
                </View>

                {/* Content */}
                <View style={styles.visitContent}>
                    <View style={styles.visitTopRow}>
                        <Text
                            style={[styles.visitWho, { color: palette.text }]}
                            numberOfLines={1}
                        >
                            {who}
                        </Text>
                        {/* Round chip */}
                        {isRound && (
                            <View style={[styles.roundChip, { backgroundColor: palette.amberChipHi }]}>
                                <Text style={[styles.roundChipText, { color: palette.amberInk }]}>
                                    round
                                </Text>
                            </View>
                        )}
                    </View>
                    <View style={styles.visitMeta}>
                        <Text style={[styles.visitDate, { color: palette.textMuted }]}>
                            {dateStr}
                        </Text>
                    </View>
                </View>

                {/* Rating */}
                <Text style={[styles.visitRating, { color: palette.star }]}>
                    {ratingStr}
                </Text>
            </View>
        </PressableScale>
    );
}

// ── AtlasPeekSheet ────────────────────────────────────────────────────────────

interface Props {
    visible: boolean;
    restaurant: AtlasRestaurantTile | null;
    city: string;
    currentUserId: string;
    palette?: typeof Colors.light;
    onClose: () => void;
}

export function AtlasPeekSheet({
    visible,
    restaurant,
    city,
    currentUserId,
    palette: paletteProp,
    onClose,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const translateY = useRef(new Animated.Value(SHEET_MAX_HEIGHT)).current;
    const dragY = useRef(new Animated.Value(0)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    // Open / close animation — same spring as AddMemberSheet
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
                    toValue: SHEET_MAX_HEIGHT,
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

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
            onPanResponderMove: (_, g) => {
                if (g.dy > 0) dragY.setValue(g.dy);
            },
            onPanResponderRelease: (_, g) => {
                if (g.dy > DRAG_DISMISS_THRESHOLD || g.vy > 0.8) {
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
        }),
    ).current;

    const sheetTranslate = Animated.add(translateY, dragY);

    const handleVisitPress = (visit: AtlasVisitRow) => {
        onClose();
        if (visit.kind === 'round') {
            router.push({
                pathname: '/table-night-detail',
                params: { nightId: visit.table_night_id },
            });
        } else {
            router.push({
                pathname: '/entry-detail',
                params: { entryId: visit.entry_id },
            });
        }
    };

    const metaLine = restaurant
        ? [city, restaurant.cuisine].filter(Boolean).join(' · ')
        : '';

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            {/* Backdrop */}
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
                <Pressable
                    style={[StyleSheet.absoluteFill, styles.backdrop]}
                    onPress={onClose}
                    accessibilityLabel="Close visit history"
                />
            </Animated.View>

            {/* Sheet */}
            <Animated.View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        paddingBottom: insets.bottom + Spacing.md,
                        maxHeight: SHEET_MAX_HEIGHT,
                        transform: [{ translateY: sheetTranslate }],
                    },
                ]}
            >
                {/* Drag handle */}
                <View {...panResponder.panHandlers} style={styles.handleArea}>
                    <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />
                </View>

                {/* Header */}
                {restaurant && (
                    <View style={styles.headerRow}>
                        <View style={styles.headerText}>
                            <View style={styles.nameLine}>
                                <Text
                                    style={[styles.restaurantName, { color: palette.text }]}
                                    numberOfLines={1}
                                >
                                    {restaurant.name}
                                </Text>
                                {restaurant.wished_by_viewer && (
                                    <View style={styles.heartIconWrap}>
                                        <Ionicons
                                            name="heart-outline"
                                            size={14}
                                            color={palette.primary}
                                        />
                                    </View>
                                )}
                            </View>
                            {metaLine.length > 0 && (
                                <Text style={[styles.metaLine, { color: palette.textMuted }]}>
                                    {metaLine}
                                </Text>
                            )}
                        </View>
                        <PressableScale onPress={onClose} haptic="selection" scaleTo={0.96}>
                            <View style={styles.closeBtn}>
                                <Ionicons name="close-outline" size={22} color={palette.textMuted} />
                            </View>
                        </PressableScale>
                    </View>
                )}

                {/* Visit list */}
                {restaurant && (
                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        style={styles.visitList}
                    >
                        {restaurant.visits.map((visit) => (
                            <VisitRow
                                key={visit.id}
                                visit={visit}
                                currentUserId={currentUserId}
                                palette={palette}
                                onPress={() => handleVisitPress(visit)}
                            />
                        ))}
                        {restaurant.visits.length === 0 && (
                            <Text style={[styles.emptyHint, { color: palette.textMuted }]}>
                                No visits recorded.
                            </Text>
                        )}
                    </ScrollView>
                )}
            </Animated.View>
        </Modal>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    backdrop: {
        backgroundColor: 'rgba(28, 28, 25, 0.4)',
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 16,
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

    // Header
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: Spacing.lg,
        paddingBottom: 14,
        gap: Spacing.sm,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    nameLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    restaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        letterSpacing: -0.3,
        lineHeight: 28,
        flex: 1,
    },
    heartIconWrap: {
        marginTop: 3,
    },
    metaLine: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        letterSpacing: 0.2,
        marginTop: 2,
    },
    closeBtn: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },

    // Visit list
    visitList: {
        paddingHorizontal: Spacing.lg,
    },
    visitRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        gap: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    avatarCircle: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
    },
    avatarImg: {
        width: 36,
        height: 36,
        borderRadius: 18,
    },
    avatarInitial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    visitContent: {
        flex: 1,
        minWidth: 0,
    },
    visitTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    visitWho: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        flex: 1,
    },
    roundChip: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: Radius.sm,
    },
    roundChipText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.8,
    },
    visitMeta: {
        marginTop: 2,
    },
    visitDate: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        fontVariant: ['tabular-nums'],
    },
    visitRating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        fontVariant: ['tabular-nums'],
        flexShrink: 0,
    },
    emptyHint: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        textAlign: 'center',
        paddingVertical: Spacing.xl,
    },
});

export default AtlasPeekSheet;
