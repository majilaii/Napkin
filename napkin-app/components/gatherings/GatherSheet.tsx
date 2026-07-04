/**
 * GatherSheet — propose a future date at this restaurant to one of your Tables
 * (TICKET-095 "Gather the table").
 *
 * Opened from the restaurant page's action dock. Copy-economy tight: the
 * restaurant name is the masthead (Newsreader italic — content), a table picker
 * only when the user has more than one Table, a WHEN row opening a future-facing
 * calendar (min tomorrow, max +90 days), an optional note, one CTA.
 *
 * Modal + KeyboardAvoidingView behavior="position" (CreateListSheet idiom) so
 * the note input rides above the iOS keyboard. The calendar overlay mirrors
 * components/log/CalendarModal but future-facing (that one hard-caps at today).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    TextInput,
    StyleSheet,
    TouchableWithoutFeedback,
    ScrollView,
    KeyboardAvoidingView,
    ActivityIndicator,
    Alert,
    Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useCreateGathering, isAlreadyProposed } from '@/hooks/gatherings';

type Palette = typeof Colors.light;

const MAX_NOTE_LENGTH = 140;
const MAX_DAYS_AHEAD = 90;

export interface GatherRestaurant {
    id?: string | null;
    name: string;
    city?: string | null;
    photo_url?: string | null;
}

interface GatherSheetProps {
    visible: boolean;
    onClose: () => void;
    /** Must be persisted (same gate as set-a-table). */
    restaurant: GatherRestaurant;
    /** Preselected Table. Else the user picks (chips shown only with >1 table). */
    tableId?: string | null;
}

/** Start of the day n days from now (device-local; the server re-validates HKT). */
function dayFromNow(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Local-time YYYY-MM-DD (never toISOString — UTC can shift the day). */
function toYMD(d: Date): string {
    return d.toLocaleDateString('en-CA');
}

/** "sat · jul 12" — the row + toast date label. */
function fmtDay(d: Date): string {
    const wd = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    const mo = d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
    return `${wd} · ${mo} ${d.getDate()}`;
}

export function GatherSheet({ visible, onClose, restaurant, tableId }: GatherSheetProps) {
    const scheme = 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();
    const toast = useToast();
    const { user } = useAuth();

    const { data: tableMemberships } = useTables(user?.id);
    const tableList = useMemo(
        () => (tableMemberships ?? []).map((m) => m.tables).filter(Boolean),
        [tableMemberships],
    );

    const [selectedTableId, setSelectedTableId] = useState<string | null>(tableId ?? null);
    const [gatherDate, setGatherDate] = useState<Date>(() => dayFromNow(1));
    const [calendarVisible, setCalendarVisible] = useState(false);
    const [note, setNote] = useState('');

    const createGathering = useCreateGathering();

    // Default the Table to the only one (or the prop) when the sheet opens.
    useEffect(() => {
        if (!visible) return;
        if (!selectedTableId) {
            setSelectedTableId(tableId ?? (tableList.length === 1 ? tableList[0]?.id ?? null : null));
        }
    }, [visible, tableId, tableList, selectedTableId]);

    // Reset when the sheet closes.
    useEffect(() => {
        if (visible) return;
        setSelectedTableId(tableId ?? null);
        setGatherDate(dayFromNow(1));
        setNote('');
        setCalendarVisible(false);
    }, [visible, tableId]);

    const canGather = !!selectedTableId && !!restaurant.id && !createGathering.isPending;

    const handleCalendarChange = (event: DateTimePickerEvent, selected?: Date) => {
        // Android's calendar display is itself a system dialog — close the wrapper.
        if (Platform.OS === 'android') setCalendarVisible(false);
        if (event.type === 'dismissed' || !selected) return;
        const next = new Date(selected);
        next.setHours(0, 0, 0, 0);
        setGatherDate(next);
    };

    const handleGather = () => {
        if (!canGather || !selectedTableId || !restaurant.id) return;
        createGathering.mutate(
            {
                table_id: selectedTableId,
                restaurant_id: restaurant.id,
                gather_on: toYMD(gatherDate),
                note: note.trim() || undefined,
            },
            {
                onSuccess: () => {
                    toast.show(`gathering proposed — ${fmtDay(gatherDate)}`);
                    onClose();
                },
                onError: (err) => {
                    if (isAlreadyProposed(err)) {
                        Alert.alert('already gathering for this spot');
                    } else {
                        toast.show("couldn't propose the gathering");
                    }
                },
            },
        );
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
            </TouchableWithoutFeedback>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'position' : undefined}
                style={styles.avoidingView}
            >
                <View
                    style={[
                        styles.sheet,
                        { backgroundColor: palette.surface, paddingBottom: insets.bottom + Spacing.md },
                        Shadow.ambient,
                    ]}
                >
                    <View style={styles.handleArea}>
                        <View style={[styles.handle, { backgroundColor: palette.ruleInkSoft }]} />
                    </View>

                    <View style={styles.headerRow}>
                        <Pressable onPress={onClose} hitSlop={8}>
                            <Text style={[styles.cancel, { color: palette.textMuted }]}>Cancel</Text>
                        </Pressable>
                    </View>

                    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                        {/* Masthead — the spot */}
                        <Text style={[styles.restaurantName, { color: palette.text }]} numberOfLines={2}>
                            {restaurant.name}
                        </Text>
                        {restaurant.city ? (
                            <Text style={[styles.cityMeta, { color: palette.textMuted }]} numberOfLines={1}>
                                {restaurant.city}
                            </Text>
                        ) : null}

                        {/* Table picker — only when the user has more than one */}
                        {tableList.length > 1 ? (
                            <>
                                <Text style={[styles.kicker, { color: palette.textMuted }]}>The table</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tableChips}>
                                    {tableList.map((t) => {
                                        const sel = t.id === selectedTableId;
                                        return (
                                            <Pressable
                                                key={t.id}
                                                onPress={() => setSelectedTableId(t.id)}
                                                style={[styles.tableChip, { backgroundColor: sel ? palette.primary : palette.surfaceContainerLow }]}
                                            >
                                                <Text style={[styles.tableChipText, { color: sel ? '#fff' : palette.textSecondary }]} numberOfLines={1}>
                                                    {t.name}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </ScrollView>
                            </>
                        ) : null}

                        {/* When */}
                        <Text style={[styles.kicker, { color: palette.textMuted }]}>When</Text>
                        <Pressable
                            onPress={() => setCalendarVisible(true)}
                            style={({ pressed }) => [
                                styles.whenRow,
                                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.85 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="pick a date"
                        >
                            <Ionicons name="calendar-outline" size={18} color={palette.primary} />
                            <Text style={[styles.whenText, { color: palette.text }]}>{fmtDay(gatherDate)}</Text>
                            <Ionicons name="chevron-down" size={15} color={palette.textMuted} />
                        </Pressable>

                        {/* Note (optional) */}
                        <TextInput
                            style={[
                                styles.noteInput,
                                { color: palette.text, backgroundColor: palette.surfaceContainerLow },
                            ]}
                            value={note}
                            onChangeText={(t) => setNote(t.slice(0, MAX_NOTE_LENGTH))}
                            placeholder="why this spot?"
                            placeholderTextColor={palette.textMuted}
                            maxLength={MAX_NOTE_LENGTH}
                            multiline
                        />

                        {/* CTA */}
                        <Pressable
                            onPress={handleGather}
                            disabled={!canGather}
                            style={({ pressed }) => [
                                styles.cta,
                                { backgroundColor: palette.primary, opacity: !canGather ? 0.5 : pressed ? 0.9 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="gather the table"
                        >
                            {createGathering.isPending ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={styles.ctaText}>gather the table</Text>
                            )}
                        </Pressable>
                    </ScrollView>
                </View>
            </KeyboardAvoidingView>

            {/* Future-facing calendar overlay (CalendarModal chrome, min tomorrow / max +90d) */}
            <Modal
                visible={visible && calendarVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setCalendarVisible(false)}
                statusBarTranslucent
            >
                <Pressable
                    style={[styles.calendarScrim, { backgroundColor: palette.scrimDark }]}
                    onPress={() => setCalendarVisible(false)}
                    accessibilityLabel="close calendar"
                />
                <View
                    style={[
                        styles.calendarSheet,
                        { backgroundColor: palette.surfaceNote, paddingBottom: insets.bottom + Spacing.md },
                    ]}
                >
                    <View style={styles.handleArea}>
                        <View style={[styles.handle, { backgroundColor: palette.ruleInkSoft }]} />
                    </View>
                    <View style={styles.calendarHeader}>
                        <Text style={[styles.calendarKicker, { color: palette.textMuted }]}>WHEN</Text>
                        <Pressable onPress={() => setCalendarVisible(false)} hitSlop={14} accessibilityLabel="done">
                            <Text style={[styles.calendarDone, { color: palette.primary }]}>done</Text>
                        </Pressable>
                    </View>
                    <View style={styles.calendarPickerWrap}>
                        <DateTimePicker
                            value={gatherDate}
                            mode="date"
                            display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
                            minimumDate={dayFromNow(1)}
                            maximumDate={dayFromNow(MAX_DAYS_AHEAD)}
                            onChange={handleCalendarChange}
                            accentColor={palette.primary}
                            themeVariant={scheme}
                        />
                    </View>
                </View>
            </Modal>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1 },
    avoidingView: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    },
    sheet: {
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingHorizontal: Spacing.lg,
        maxHeight: '88%',
    },
    handleArea: { alignItems: 'center', paddingVertical: 10 },
    handle: { width: 40, height: 5, borderRadius: 9999 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cancel: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
    restaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 30,
        letterSpacing: -0.5,
        lineHeight: 34,
        marginTop: 10,
    },
    cityMeta: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginTop: 6,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginTop: 22,
        marginBottom: 10,
    },
    tableChips: { gap: 8, paddingRight: 8 },
    tableChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9999, maxWidth: 180 },
    tableChipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    whenRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    whenText: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
    noteInput: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 20,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        minHeight: 64,
        textAlignVertical: 'top',
        marginTop: 22,
    },
    cta: {
        height: 52,
        borderRadius: 9999,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 22,
        marginBottom: 8,
    },
    ctaText: { fontFamily: 'Manrope_700Bold', fontSize: 16, color: '#fff' },
    // Calendar overlay (mirrors components/log/CalendarModal, future-facing)
    calendarScrim: { ...StyleSheet.absoluteFillObject },
    calendarSheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 16,
    },
    calendarHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.xs,
    },
    calendarKicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    calendarDone: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
    calendarPickerWrap: {
        paddingHorizontal: Spacing.md,
        ...(Platform.OS === 'android' ? {} : { paddingTop: Spacing.xs }),
    },
});
