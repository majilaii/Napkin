/**
 * SetTableSheet — the Supper v2 "set a table" creation flow (TICKET-082 v2).
 *
 * Two steps inside one sheet:
 *   compose → pick the Table + gather the crew (everyone, incl. you, an empty seat)
 *   confirm → "the table is set" — ghosted seats, add-your-take-now / maybe-later.
 *
 * No review is taken here. "set the table" creates the supper anchor + seeds the
 * roster (useSetTable); takes attach later. The restaurant is pre-filled by the
 * caller (restaurant-anchored). Modal + spring shell cloned from CompanionPickerSheet.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    Modal,
    Animated,
    StyleSheet,
    PanResponder,
    ScrollView,
    Image,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { useSetTable, type SetTableResult } from '@/hooks/suppers';
import { InitialsAvatar } from './InitialsAvatar';

type Palette = typeof Colors.light;

export interface SetTableRestaurant {
    id?: string | null;
    name: string;
    city?: string | null;
    photo_url?: string | null;
}

interface SetTableSheetProps {
    visible: boolean;
    onClose: () => void;
    restaurant: SetTableRestaurant;
    /** Preselected Table (when launched from a Table feed). Else the user picks. */
    tableId?: string | null;
}

const SHEET_HEIGHT = 640;
const DRAG_DISMISS_THRESHOLD = 80;

export function SetTableSheet({ visible, onClose, restaurant, tableId }: SetTableSheetProps) {
    const scheme = 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const toast = useToast();
    const { user } = useAuth();

    const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
    const dragY = useRef(new Animated.Value(0)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    const { data: tableMemberships } = useTables(user?.id);
    const tableList = useMemo(
        () => (tableMemberships ?? []).map((m) => m.tables).filter(Boolean),
        [tableMemberships],
    );

    const [step, setStep] = useState<'compose' | 'confirm'>('compose');
    const [selectedTableId, setSelectedTableId] = useState<string | null>(tableId ?? null);
    const [crew, setCrew] = useState<Set<string>>(new Set());
    const [crewInit, setCrewInit] = useState(false);
    const [result, setResult] = useState<SetTableResult | null>(null);

    const setTable = useSetTable();
    const { data: members, isLoading: loadingMembers } = useTableMembers(selectedTableId);

    // Default the Table to the only one (or the prop) when the sheet opens.
    useEffect(() => {
        if (!visible) return;
        if (!selectedTableId) {
            setSelectedTableId(tableId ?? (tableList.length === 1 ? tableList[0]?.id ?? null : null));
        }
    }, [visible, tableId, tableList, selectedTableId]);

    // Default the crew to the whole Table (minus you) once members load.
    useEffect(() => {
        if (!members || crewInit) return;
        const others = members.map((m) => m.member_id).filter((id) => id !== user?.id);
        setCrew(new Set(others));
        setCrewInit(true);
    }, [members, crewInit, user?.id]);

    // Reset everything when the sheet closes.
    useEffect(() => {
        if (visible) return;
        setStep('compose');
        setResult(null);
        setCrew(new Set());
        setCrewInit(false);
        setSelectedTableId(tableId ?? null);
    }, [visible, tableId]);

    // ── Open / close animation ───────────────────────────────────────────────
    useEffect(() => {
        if (visible) {
            dragY.setValue(0);
            Animated.parallel([
                Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220 }),
                Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.spring(translateY, { toValue: SHEET_HEIGHT, useNativeDriver: true, damping: 30, stiffness: 300 }),
                Animated.timing(backdropOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
            ]).start();
        }
    }, [visible, translateY, dragY, backdropOpacity]);

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 6,
            onPanResponderMove: (_, gs) => {
                if (gs.dy > 0) dragY.setValue(gs.dy);
            },
            onPanResponderRelease: (_, gs) => {
                if (gs.dy > DRAG_DISMISS_THRESHOLD || gs.vy > 0.8) onClose();
                else Animated.spring(dragY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 200 }).start();
            },
        }),
    ).current;
    const sheetTranslate = Animated.add(translateY, dragY);

    const others = (members ?? []).filter((m) => m.member_id !== user?.id);
    const seatCount = 1 + crew.size;
    const canSet = !!selectedTableId && !!restaurant.id && !setTable.isPending;

    const toggleCrew = (memberId: string) => {
        setCrew((prev) => {
            const next = new Set(prev);
            if (next.has(memberId)) next.delete(memberId);
            else next.add(memberId);
            return next;
        });
    };

    const handleSetTable = () => {
        if (!canSet || !selectedTableId || !restaurant.id) return;
        setTable.mutate(
            { table_id: selectedTableId, restaurant_id: restaurant.id, member_ids: [...crew] },
            {
                onSuccess: (res) => {
                    setResult(res);
                    setStep('confirm');
                    toast.show(`table set — ${res.member_count} seats, 0 gathered`);
                },
                onError: () => toast.show("couldn't set the table"),
            },
        );
    };

    const handleAddTakeNow = () => {
        if (!result) return;
        onClose();
        router.push({
            pathname: '/log-meal',
            params: {
                supperTakeId: result.id,
                restaurant: JSON.stringify({ id: restaurant.id, name: restaurant.name }),
            },
        });
    };

    // Confirmation seat avatars (you + crew), all ghosted (no one has gathered yet).
    const confirmSeats = useMemo(() => {
        const youProfile = members?.find((m) => m.member_id === user?.id)?.profiles;
        const you = { user_id: user?.id ?? 'you', display_name: youProfile?.display_name ?? 'you', avatar_url: youProfile?.avatar_url ?? null };
        const picked = others
            .filter((m) => crew.has(m.member_id))
            .map((m) => ({ user_id: m.member_id, display_name: m.profiles?.display_name ?? null, avatar_url: m.profiles?.avatar_url ?? null }));
        return [you, ...picked];
    }, [members, others, crew, user?.id]);

    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
                <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} accessibilityLabel="Close" />
            </Animated.View>

            <Animated.View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.surface,
                        paddingBottom: insets.bottom + Spacing.md,
                        transform: [{ translateY: sheetTranslate }],
                    },
                ]}
            >
                <View {...panResponder.panHandlers} style={styles.handleArea}>
                    <View style={[styles.handle, { backgroundColor: palette.ruleInkSoft }]} />
                </View>

                {step === 'compose' ? (
                    <>
                        {/* Header */}
                        <View style={styles.headerRow}>
                            <Pressable onPress={onClose} hitSlop={8}>
                                <Text style={[styles.cancel, { color: palette.textMuted }]}>Cancel</Text>
                            </Pressable>
                        </View>
                        <View style={styles.titleBlock}>
                            <Text style={[styles.title, { color: palette.text }]}>set a table</Text>
                            <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
                                pick the spot, gather your people — everyone adds their own take.
                            </Text>
                        </View>

                        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                            {/* The spot */}
                            <Text style={[styles.kicker, { color: palette.textMuted }]}>The spot</Text>
                            <View style={[styles.spotCard, { backgroundColor: palette.surfaceNote }]}>
                                {restaurant.photo_url ? (
                                    <Image source={{ uri: restaurant.photo_url }} style={styles.spotThumb} />
                                ) : (
                                    <View style={[styles.spotThumb, { backgroundColor: palette.surfaceContainerHigh }]} />
                                )}
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={[styles.spotName, { color: palette.text }]} numberOfLines={1}>{restaurant.name}</Text>
                                    {restaurant.city ? (
                                        <Text style={[styles.spotCity, { color: palette.textMuted }]} numberOfLines={1}>{restaurant.city}</Text>
                                    ) : null}
                                </View>
                            </View>

                            {/* Table picker — only when the user has more than one */}
                            {tableList.length > 1 ? (
                                <>
                                    <Text style={[styles.kicker, { color: palette.textMuted, marginTop: 22 }]}>The table</Text>
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tableChips}>
                                        {tableList.map((t) => {
                                            const sel = t.id === selectedTableId;
                                            return (
                                                <Pressable
                                                    key={t.id}
                                                    onPress={() => { setSelectedTableId(t.id); setCrewInit(false); }}
                                                    style={[styles.tableChip, { backgroundColor: sel ? palette.primary : palette.surfaceContainerLow }]}
                                                >
                                                    <Text style={[styles.tableChipText, { color: sel ? '#fff' : palette.textSecondary }]} numberOfLines={1}>{t.name}</Text>
                                                </Pressable>
                                            );
                                        })}
                                    </ScrollView>
                                </>
                            ) : null}

                            {/* The crew */}
                            <View style={styles.crewHeader}>
                                <Text style={[styles.kicker, { color: palette.textMuted }]}>The crew</Text>
                                <Text style={[styles.crewCount, { color: palette.textMuted }]}>{crew.size} chosen · {seatCount} seats</Text>
                            </View>

                            {/* You — always a seat */}
                            <View style={styles.memberRow}>
                                <InitialsAvatar name="you" avatarUrl={members?.find((m) => m.member_id === user?.id)?.profiles?.avatar_url ?? null} size={38} palette={palette} />
                                <Text style={[styles.youName, { color: palette.text }]}>you <Text style={[styles.youMeta, { color: palette.textMuted }]}>· your seat</Text></Text>
                                <View style={[styles.alwaysPill, { backgroundColor: palette.secondaryContainer }]}>
                                    <Text style={[styles.alwaysText, { color: palette.textSecondary }]}>always</Text>
                                </View>
                            </View>

                            {loadingMembers ? (
                                <ActivityIndicator size="small" color={palette.textMuted} style={{ marginTop: Spacing.md }} />
                            ) : (
                                others.map((m) => {
                                    const sel = crew.has(m.member_id);
                                    return (
                                        <Pressable key={m.member_id} onPress={() => toggleCrew(m.member_id)} style={styles.memberRow} accessibilityRole="button" accessibilityState={{ selected: sel }}>
                                            <View style={{ opacity: sel ? 1 : 0.5 }}>
                                                <InitialsAvatar name={m.profiles?.display_name} avatarUrl={m.profiles?.avatar_url ?? null} size={38} palette={palette} />
                                            </View>
                                            <Text style={[styles.memberName, { color: palette.text }]} numberOfLines={1}>{m.profiles?.display_name ?? 'Member'}</Text>
                                            {sel ? (
                                                <View style={[styles.checkCircle, { backgroundColor: palette.primary }]}>
                                                    <Ionicons name="checkmark" size={14} color="#fff" />
                                                </View>
                                            ) : (
                                                <View style={[styles.emptyCircle, { borderColor: palette.ruleInkSoft }]} />
                                            )}
                                        </Pressable>
                                    );
                                })
                            )}
                            {!loadingMembers && others.length === 0 ? (
                                <Text style={[styles.emptyCrew, { color: palette.textMuted }]}>
                                    no one else at this table yet — you can still set a table for yourself.
                                </Text>
                            ) : null}

                            <View style={{ height: 20 }} />
                        </ScrollView>

                        {/* CTA */}
                        <Pressable
                            onPress={handleSetTable}
                            disabled={!canSet}
                            style={({ pressed }) => [styles.cta, { backgroundColor: palette.primary, opacity: !canSet ? 0.5 : pressed ? 0.9 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel="set the table"
                        >
                            {setTable.isPending ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={styles.ctaText}>set the table</Text>
                            )}
                        </Pressable>
                        <Text style={[styles.ctaCaption, { color: palette.textMuted }]}>everyone, including you, starts as an empty seat.</Text>
                    </>
                ) : (
                    // ── Confirmation ──────────────────────────────────────────────
                    <View style={styles.confirm}>
                        <Text style={[styles.confirmKicker, { color: palette.primary }]}>the table is set</Text>
                        <Text style={[styles.confirmName, { color: palette.text }]}>{restaurant.name}</Text>
                        <Text style={[styles.confirmMeta, { color: palette.textMuted }]}>
                            {restaurant.city ? `${restaurant.city} · ` : ''}{seatCount} seats · 0 gathered
                        </Text>

                        <View style={styles.confirmSeats}>
                            {confirmSeats.slice(0, 6).map((s, i) => (
                                <View key={s.user_id} style={{ marginLeft: i === 0 ? 0 : -12, opacity: 0.34, borderRadius: 27, borderWidth: 3, borderColor: palette.surface }}>
                                    <InitialsAvatar name={s.display_name} avatarUrl={s.avatar_url} size={54} palette={palette} />
                                </View>
                            ))}
                        </View>
                        <Text style={[styles.confirmSeatsLabel, { color: palette.textMuted }]}>
                            {seatCount} empty {seatCount === 1 ? 'seat' : 'seats'}, waiting
                        </Text>

                        <Text style={[styles.confirmLine, { color: palette.textSecondary }]}>
                            we let everyone know. add your take whenever the night comes back to you.
                        </Text>

                        <Pressable onPress={handleAddTakeNow} style={({ pressed }) => [styles.confirmCta, { backgroundColor: palette.primary, opacity: pressed ? 0.9 : 1 }]} accessibilityRole="button">
                            <Text style={styles.ctaText}>add your take now</Text>
                        </Pressable>
                        <Pressable onPress={onClose} hitSlop={8} style={{ marginTop: 16 }}>
                            <Text style={[styles.maybeLater, { color: palette.textSecondary }]}>maybe later</Text>
                        </Pressable>
                    </View>
                )}
            </Animated.View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { backgroundColor: 'rgba(28, 28, 25, 0.4)' },
    sheet: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
        shadowColor: '#1c1c19', shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.08, shadowRadius: 24, elevation: 16,
        minHeight: SHEET_HEIGHT, maxHeight: '92%',
        paddingHorizontal: Spacing.lg,
    },
    handleArea: { alignItems: 'center', paddingVertical: 10 },
    handle: { width: 40, height: 5, borderRadius: 9999 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cancel: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
    titleBlock: { marginTop: 8, marginBottom: 8 },
    title: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 30, letterSpacing: -0.5 },
    subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 14, lineHeight: 20, marginTop: 6 },
    kicker: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 18, marginBottom: 10 },
    spotCard: { flexDirection: 'row', alignItems: 'center', gap: 13, borderRadius: 16, padding: 12 },
    spotThumb: { width: 52, height: 52, borderRadius: 12 },
    spotName: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 20, lineHeight: 24 },
    spotCity: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', marginTop: 5 },
    tableChips: { gap: 8, paddingRight: 8 },
    tableChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9999, maxWidth: 180 },
    tableChipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    crewHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    crewCount: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
    youName: { flex: 1, fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17 },
    youMeta: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
    alwaysPill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9999 },
    alwaysText: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
    memberName: { flex: 1, fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17 },
    checkCircle: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    emptyCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5 },
    emptyCrew: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19, marginTop: 8 },
    cta: { height: 52, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
    ctaText: { fontFamily: 'Manrope_700Bold', fontSize: 16, color: '#fff' },
    ctaCaption: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center', marginTop: 12 },
    // Confirmation
    confirm: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    confirmKicker: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' },
    confirmName: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 38, letterSpacing: -0.6, marginTop: 14, textAlign: 'center' },
    confirmMeta: { fontFamily: 'Manrope_500Medium', fontSize: 12, letterSpacing: 0.4, marginTop: 10 },
    confirmSeats: { flexDirection: 'row', marginTop: 32 },
    confirmSeatsLabel: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 14 },
    confirmLine: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 18, lineHeight: 27, textAlign: 'center', marginTop: 32 },
    confirmCta: { height: 50, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, marginTop: 30 },
    maybeLater: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
