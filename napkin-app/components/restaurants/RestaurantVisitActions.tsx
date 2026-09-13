import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';
import { useRestaurantVisitMutations } from '@/hooks/restaurants/useRestaurantVisitMutations';
import { safeRandomUUID } from '@/lib/uuid';
import { InlineStars } from '@/components/feed/InlineStars';

type Props = {
    userId?: string; pageId: string; restaurantId?: string | null; restaurantPayload?: RestaurantPayload | null;
    restaurantName: string; visits: SelfLogRow[]; disabled?: boolean; palette: typeof Colors.light; onLog: () => void;
    onOpenVisit: (visit: SelfLogRow) => void;
    onReview: (visit: SelfLogRow) => void;
    /** The exact visit returned by a completed composer save. */
    selectedVisitId?: string | null;
    /** Restaurant-page query freshness distinguishes a pending save from deletion. */
    visitsUpdatedAt?: number;
    visitsRefreshing?: boolean;
    onMissingVisit?: () => void;
};
export function visitDateLabel(iso: string | null) {
    if (!iso) return 'No date';
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return 'No date';
    const day = date.toDateString() === new Date().toDateString()
        ? 'Today'
        : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${day} · ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
export function orderVisits(visits: SelfLogRow[]) {
    return [...visits].sort((a, b) => (b.created_at ?? b.visited_at ?? '').localeCompare(a.created_at ?? a.visited_at ?? '') || b.id.localeCompare(a.id));
}

function hasReview(visit: SelfLogRow) {
    return visit.rating != null || !!visit.note?.trim() || visit.photos.length > 0;
}

export function RestaurantVisitActions({ userId, pageId, restaurantId, restaurantPayload, restaurantName, visits, disabled, palette, onLog, onOpenVisit, onReview, selectedVisitId, visitsUpdatedAt = 0, visitsRefreshing = false, onMissingVisit }: Props) {
    const insets = useSafeAreaInsets();
    const mutations = useRestaurantVisitMutations(userId, pageId);
    const rows = useMemo(() => orderVisits(visits), [visits]);
    const [selectedId, setSelectedId] = useState<string | null>(selectedVisitId ?? null);
    const [undoId, setUndoId] = useState<string | null>(null);
    const [sheet, setSheet] = useState<'history' | 'date' | null>(null);
    const [calendar, setCalendar] = useState(false);
    const [chosenDate, setChosenDate] = useState(new Date());
    const [error, setError] = useState<string | null>(null);
    const [recordRetry, setRecordRetry] = useState(false);
    const operation = useRef(false);
    const nonce = useRef<string | null>(null);
    // Follow a new save result once. A background data refresh must not reset
    // a visit the user deliberately selected from their history.
    useEffect(() => {
        if (selectedVisitId) setSelectedId(selectedVisitId);
    }, [selectedVisitId]);
    const current = selectedId
        ? rows.find((v) => (v.entry_id ?? v.id) === selectedId)
        : rows[0];
    const selectionSnapshot = useRef<{ id: string; updatedAt: number } | null>(null);
    useEffect(() => {
        if (!selectedId) {
            selectionSnapshot.current = null;
            return;
        }
        if (selectionSnapshot.current?.id !== selectedId || current) {
            selectionSnapshot.current = { id: selectedId, updatedAt: visitsUpdatedAt };
            return;
        }
        // An absent saved row may still be arriving. Only a newer, settled
        // snapshot can establish that the selected visit no longer exists.
        // Retain the previous snapshot during refresh, including its final
        // cache write, so the next settled render can make that decision.
        if (visitsRefreshing || visitsUpdatedAt === selectionSnapshot.current.updatedAt) return;
        selectionSnapshot.current = null;
        setSelectedId(null);
        setUndoId(null);
        setSheet(null);
        setCalendar(false);
        onMissingVisit?.();
    }, [selectedId, current, visitsUpdatedAt, visitsRefreshing, onMissingVisit]);
    // Never offer to review a different visit while a returned ID is loading.
    const awaitingSelection = !!selectedId && !current;
    const number = current ? rows.length - rows.indexOf(current) : 0;
    const editable = !!current?.entry_id && current.source === 'solo' && !current.supper_id && !current.table_night_id;
    const reviewed = !!current && hasReview(current);
    const pending = mutations.record.isPending || mutations.save.isPending || mutations.undo.isPending;
    const locked = !!(pending || disabled || !userId || awaitingSelection);
    const canRecord = !!(restaurantId || restaurantPayload);
    const record = async () => {
        if (operation.current || locked || !canRecord) return;
        operation.current = true;
        nonce.current ??= safeRandomUUID();
        setError(null);
        try {
            const result = await mutations.record.mutateAsync({
                client_nonce: nonce.current,
                ...(restaurantId ? { restaurant_id: restaurantId } : { restaurant: restaurantPayload ?? undefined }),
            });
            nonce.current = null;
            setRecordRetry(false);
            setSelectedId(result.entry.id);
            setUndoId(result.entry.is_bare ? result.entry.id : null);
            setSheet(null);
        } catch (err) {
            setRecordRetry(true);
            setError(err instanceof Error ? err.message : 'Couldn’t record your visit. Please try again.');
        } finally { operation.current = false; }
    };
    const undo = async () => {
        if (operation.current || locked || recordRetry || !current?.entry_id) return;
        operation.current = true;
        setError(null);
        try { await mutations.undo.mutateAsync(current.entry_id); setUndoId(null); setSelectedId(null); }
        catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t undo this visit. Please try again.'); }
        finally { operation.current = false; }
    };
    const date = async (value: string | null) => {
        if (operation.current || locked || recordRetry || !editable || !current?.entry_id) return;
        operation.current = true;
        setError(null);
        try {
            await mutations.save.mutateAsync({ entry_id: current.entry_id, patch: { visited_at: value } });
            setSheet(null); setCalendar(false); setUndoId(null);
        } catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t save the date. Please try again.'); }
        finally { operation.current = false; }
    };
    const close = () => { if (!operation.current && !pending) { setSheet(null); setCalendar(false); setError(null); } };
    const log = () => {
        if (operation.current || locked || recordRetry) return;
        setSheet(null);
        setError(null);
        onLog();
    };
    const openVisit = () => {
        if (operation.current || locked || recordRetry || !current) return;
        setError(null);
        onOpenVisit(current);
    };
    const review = () => {
        if (operation.current || locked || recordRetry || !current || !editable || reviewed) return;
        setError(null);
        onReview(current);
    };
    return (
        <View style={styles.wrapper}>
            <View style={styles.buttons}>
                <Pressable onPress={() => void record()} disabled={locked || recordRetry || !canRecord} accessibilityRole="button" accessibilityLabel="Check in" accessibilityState={{ disabled: locked || recordRetry || !canRecord }}
                    style={({ pressed }) => [styles.button, { backgroundColor: palette.surfaceJournal, opacity: locked || recordRetry || !canRecord ? 0.5 : 1 }, pressed && styles.pressed]}>
                    {mutations.record.isPending ? <ActivityIndicator color={palette.primary} /> : <Ionicons name="footsteps-outline" size={20} color={palette.primary} />}
                    <Text style={[styles.label, { color: palette.primary }]}>Check in</Text>
                </Pressable>
                <Pressable disabled={locked || recordRetry} onPress={log} accessibilityRole="button" accessibilityLabel="Log a meal" accessibilityState={{ disabled: locked || recordRetry }}
                    style={({ pressed }) => [styles.button, { backgroundColor: palette.primary, opacity: locked || recordRetry ? 0.5 : 1 }, pressed && styles.pressed]}>
                    <Ionicons name="create-outline" size={20} color={palette.textInverse} />
                    <Text style={[styles.label, { color: palette.textInverse }]}>Log a meal</Text>
                </Pressable>
            </View>
            {error && !sheet ? <View style={styles.error}>
                <Text accessibilityRole="alert" style={[Type.bodySmall, { color: palette.error }]}>{error}</Text>
                {recordRetry ? <Pressable disabled={locked} onPress={() => void record()} accessibilityRole="button" accessibilityLabel="Retry check-in" style={styles.textButton}>
                    <Text style={[Type.restaurantSectionAction, { color: palette.primary }]}>Retry check-in</Text>
                </Pressable> : null}
            </View> : null}
            {current || awaitingSelection ? <View style={[styles.visits, { borderColor: palette.ghostRule }]}>
                <View style={styles.visitsHead}>
                    <Text style={[Type.restaurantHistoryDateline, { color: palette.textMuted }]}>YOUR VISITS</Text>
                    <Pressable disabled={locked || recordRetry} onPress={() => setSheet('history')} accessibilityRole="button" accessibilityLabel={`Visit history, ${rows.length} ${rows.length === 1 ? 'visit' : 'visits'}`} style={styles.count}>
                        <Text style={[Type.restaurantSectionAction, { color: palette.primary }]}>{rows.length} {rows.length === 1 ? 'visit' : 'visits'}</Text>
                        <Ionicons name="chevron-forward" size={14} color={palette.primary} />
                    </Pressable>
                </View>
                {awaitingSelection ? <View style={styles.loading} accessibilityLiveRegion="polite">
                    <ActivityIndicator color={palette.primary} />
                    <Text style={[styles.meta, { color: palette.textMuted }]}>Loading your visit…</Text>
                </View> : current ? <View style={styles.receipt} accessibilityLiveRegion="polite">
                    <View style={styles.dateline}>
                        <Pressable disabled={locked || recordRetry || !editable} onPress={() => { setError(null); setSheet('date'); }} style={styles.dateButton} accessibilityRole={editable ? 'button' : undefined} accessibilityLabel={editable ? `Change date for visit ${number}` : undefined}>
                            <Text style={[styles.meta, { color: palette.textMuted }]}>{current.visited_at ? visitDateLabel(current.visited_at) : editable ? 'Add a date' : 'No date'}</Text>
                        </Pressable>
                        {current.is_bare && current.entry_id === undoId ? <Pressable disabled={locked || recordRetry} onPress={() => void undo()} accessibilityRole="button" accessibilityLabel="Undo check-in" style={styles.textButton}>
                            <Text style={[styles.meta, { color: palette.textMuted }]}>Undo</Text>
                        </Pressable> : null}
                    </View>
                    {editable && !reviewed ? <View style={styles.checkInRow}>
                        <View style={styles.status}><Ionicons name="checkmark" size={16} color={palette.secondary} /><Text style={[Type.bodySmall, { color: palette.secondary }]}>Checked in</Text></View>
                        <Pressable disabled={locked || recordRetry} onPress={review} accessibilityRole="button" accessibilityLabel="Add review" style={styles.textButton}>
                            <Text style={[Type.restaurantSectionAction, { color: palette.primary }]}>Add review</Text>
                        </Pressable>
                    </View> : <Pressable disabled={locked || recordRetry} onPress={openVisit} accessibilityRole="button" accessibilityLabel={`Open visit ${number}`} accessibilityHint={[visitDateLabel(current.visited_at), current.rating != null ? `${current.rating.toFixed(1)} out of 5` : '', current.note?.trim(), current.photos.length ? `${current.photos.length} photos` : ''].filter(Boolean).join('. ')} style={({ pressed }) => [styles.review, pressed && styles.pressed]}>
                        <View style={styles.reviewCopy}>
                            {current.rating != null ? <View accessible accessibilityLabel={`Your rating ${current.rating.toFixed(1)} out of 5`} style={styles.rating}>
                                <InlineStars value={current.rating} size={Type.body.fontSize} color={palette.amberBright} />
                            </View> : !current.note?.trim() ? <Text style={[Type.bodySmall, { color: palette.textMuted }]}>{current.photos.length ? `${current.photos.length} ${current.photos.length === 1 ? 'photo' : 'photos'}` : 'Checked in'}</Text> : null}
                            {current.note?.trim() ? <Text style={[Type.restaurantHistoryNote, { color: palette.text }]} numberOfLines={2}>{current.note.trim()}</Text> : null}
                        </View>
                        {current.photos[0] ? <Image source={{ uri: current.photos[0].url }} accessibilityLabel="Your meal photo" style={[styles.photo, { borderColor: palette.imageOutline }]} /> : null}
                        <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                    </Pressable>}
                </View> : null}
            </View> : null}
            {sheet && current ? <Modal transparent animationType="fade" onRequestClose={close}>
                <View style={[styles.scrim, { backgroundColor: palette.overlay }]}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close visit sheet" />
                    <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: palette.background, paddingBottom: insets.bottom + Spacing.lg }]}>
                        <View style={styles.sheetHead}>
                            <Text style={[Type.screenTitle, styles.sheetTitle, { color: palette.text }]}>{sheet === 'history' ? 'Your visits' : 'Visit date'}</Text>
                            <Pressable disabled={pending} onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={24} color={palette.textMuted} /></Pressable>
                        </View>
                        <Text style={[styles.meta, styles.sheetSubtitle, { color: palette.textMuted }]}>{restaurantName}{sheet === 'date' ? ` · visit ${number}` : ''}</Text>
                        <ScrollView>
                            {sheet === 'history' ? rows.map((row, index) => (
                                <Pressable key={row.id} disabled={locked || recordRetry} onPress={() => { setSelectedId(row.entry_id ?? row.id); close(); }} style={[styles.historyRow, { borderBottomColor: palette.ghostRule }]} accessibilityRole="button" accessibilityLabel={`Visit ${rows.length - index}, ${hasReview(row) ? 'reviewed' : 'no review'}, ${visitDateLabel(row.visited_at)}`} accessibilityState={{ selected: row.id === current?.id }}>
                                    <View style={styles.historyCopy}>
                                        <Text style={[Type.bodySmall, { color: palette.text }]}>Visit {rows.length - index} · {hasReview(row) ? 'Reviewed' : 'Checked in'}</Text>
                                        <Text style={[styles.meta, { color: palette.textMuted }]}>{visitDateLabel(row.visited_at)}{row.rating != null ? ` · ${row.rating.toFixed(1)}★` : !hasReview(row) ? ' · No review yet' : ''}</Text>
                                    </View>
                                    {row.id === current?.id ? <Ionicons name="checkmark" size={20} color={palette.primary} /> : <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />}
                                </Pressable>
                            )) : <>
                                {['No date', 'Today', 'Yesterday', 'Another day'].map((label, index) => <Pressable key={label} disabled={pending} style={styles.dateOption} accessibilityRole="button"
                                    onPress={() => {
                                        if (index === 3) { setChosenDate(current?.visited_at ? new Date(current.visited_at) : new Date()); setCalendar(true); return; }
                                        const d = new Date(); if (index === 2) d.setDate(d.getDate() - 1);
                                        void date(index === 0 ? null : d.toISOString());
                                    }}><Text style={[Type.body, { color: palette.text }]}>{label}</Text></Pressable>)}
                                {calendar ? <>
                                    <DateTimePicker value={chosenDate} mode="date" display="inline" maximumDate={new Date()} onChange={(_, value) => { if (value) setChosenDate(value); }} />
                                    <Pressable disabled={pending} onPress={() => void date(chosenDate.toISOString())} style={[styles.dateSave, { backgroundColor: palette.primary }]} accessibilityRole="button"><Text style={[styles.label, { color: palette.textInverse }]}>Save date</Text></Pressable>
                                </> : null}
                            </>}
                            {pending ? <ActivityIndicator color={palette.primary} /> : null}
                            {error ? <Text accessibilityRole="alert" style={[Type.bodySmall, { color: palette.error }]}>{error}</Text> : null}
                        </ScrollView>
                    </View>
                </View>
            </Modal> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: { gap: Spacing.sm },
    buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    button: { minHeight: Spacing.restaurant.primaryActionHeight, borderRadius: Radius.md, flexGrow: 1, flexBasis: 132, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.md },
    label: { ...Type.bodySmall, fontFamily: 'Manrope_600SemiBold', fontWeight: '600', flexShrink: 1, textAlign: 'center' },
    pressed: { transform: [{ scale: 0.96 }] },
    visits: { marginTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: Spacing.sm },
    visitsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingTop: Spacing.sm },
    count: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: Spacing.hitTarget },
    receipt: { gap: Spacing.xs },
    dateline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
    dateButton: { minHeight: Spacing.hitTarget, justifyContent: 'center', flexShrink: 1 },
    meta: { ...Type.caption, fontVariant: ['tabular-nums'] },
    textButton: { minHeight: Spacing.hitTarget, minWidth: Spacing.hitTarget, justifyContent: 'center', alignItems: 'flex-end' },
    checkInRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
    status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: Spacing.hitTarget },
    review: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: Spacing.hitTarget, paddingVertical: Spacing.xs },
    reviewCopy: { flex: 1, gap: Spacing.xs },
    rating: { minHeight: Spacing.lg, justifyContent: 'center' },
    photo: { width: 48, height: 48, borderRadius: Radius.sm, borderWidth: 1 },
    error: { gap: Spacing.xs },
    loading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 52 },
    scrim: { flex: 1, justifyContent: 'flex-end' },
    sheet: { maxHeight: '85%', borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
    sheetTitle: { flex: 1 },
    sheetSubtitle: { marginBottom: Spacing.sm },
    close: { width: Spacing.hitTarget, height: Spacing.hitTarget, justifyContent: 'center', alignItems: 'flex-end' },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
    historyCopy: { flex: 1, gap: Spacing.xs },
    dateOption: { minHeight: 48, justifyContent: 'center' },
    dateSave: { minHeight: 52, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', padding: Spacing.md },
});
