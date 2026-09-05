import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Type } from '@/constants/theme';
import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';
import { useRestaurantVisitMutations } from '@/hooks/restaurants/useRestaurantVisitMutations';
import { safeRandomUUID } from '@/lib/uuid';
import { PhotoLightbox } from '@/components/photos/PhotoLightbox';
import { VisitReviewSheet } from './VisitReviewSheet';

type Props = {
    userId?: string; pageId: string; restaurantId?: string | null; restaurantPayload?: RestaurantPayload | null;
    restaurantName: string; visits: SelfLogRow[]; disabled?: boolean; palette: typeof Colors.light; onLog: () => void;
    onOpenVisit: (visit: SelfLogRow) => void;
};
export function visitDateLabel(iso: string | null) {
    return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'no date';
}
export function orderVisits(visits: SelfLogRow[]) {
    return [...visits].sort((a, b) => (b.created_at ?? b.visited_at ?? '').localeCompare(a.created_at ?? a.visited_at ?? '') || b.id.localeCompare(a.id));
}

export function RestaurantVisitActions({ userId, pageId, restaurantId, restaurantPayload, restaurantName, visits, disabled, palette, onLog, onOpenVisit }: Props) {
    const insets = useSafeAreaInsets();
    const mutations = useRestaurantVisitMutations(userId, pageId);
    const rows = useMemo(() => orderVisits(visits), [visits]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [undoId, setUndoId] = useState<string | null>(null);
    const [sheet, setSheet] = useState<'history' | 'date' | 'review' | null>(null);
    const [calendar, setCalendar] = useState(false);
    const [chosenDate, setChosenDate] = useState(new Date());
    const [photoIndex, setPhotoIndex] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [recordRetry, setRecordRetry] = useState(false);
    const operation = useRef(false);
    const nonce = useRef<string | null>(null);
    const current = rows.find((v) => (v.entry_id ?? v.id) === selectedId) ?? rows[0];
    const number = current ? rows.length - rows.indexOf(current) : 0;
    const editable = !!current?.entry_id && current.source === 'solo' && !current.supper_id && !current.table_night_id;
    const reviewed = !!current && (current.rating != null || !!current.note?.trim() || current.photos.length > 0);
    const pending = mutations.record.isPending || mutations.save.isPending || mutations.undo.isPending;
    const locked = pending || disabled || !userId;
    const record = async () => {
        if (operation.current || locked) return;
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
        } catch (err) {
            setRecordRetry(true);
            setError(err instanceof Error ? err.message : 'Couldn’t record your visit. Please try again.');
        } finally { operation.current = false; }
    };
    const undo = async () => {
        if (operation.current || locked || !current?.entry_id) return;
        operation.current = true;
        setError(null);
        try { await mutations.undo.mutateAsync(current.entry_id); setUndoId(null); setSelectedId(null); }
        catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t undo this visit. Please try again.'); }
        finally { operation.current = false; }
    };
    const date = async (value: string | null) => {
        if (operation.current || locked || !current?.entry_id) return;
        operation.current = true;
        setError(null);
        try {
            await mutations.save.mutateAsync({ entry_id: current.entry_id, patch: { visited_at: value } });
            setSheet(null); setCalendar(false); setUndoId(null);
        } catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t save the date. Please try again.'); }
        finally { operation.current = false; }
    };
    const close = () => { if (!operation.current && !pending) { setSheet(null); setCalendar(false); setError(null); } };
    return (
        <View style={styles.wrapper}>
            {current ? (
                <View style={[styles.plate, { backgroundColor: palette.surfaceJournal }]}>
                    <View style={styles.plateHead}>
                        <Pressable disabled={locked} onPress={() => setSheet('history')} accessibilityRole="button" accessibilityLabel={`Visit history, ${rows.length} visits`} style={styles.count}>
                            <Ionicons name="checkmark" size={17} color={palette.secondary} />
                            <Text style={[styles.label, { color: palette.text }]}>Been here · {rows.length} {rows.length === 1 ? 'visit' : 'visits'}</Text>
                            <Ionicons name="chevron-forward" size={14} color={palette.textMuted} />
                        </Pressable>
                        {current.is_bare && current.entry_id === undoId ? (
                            <Pressable disabled={locked} onPress={() => void undo()} accessibilityRole="button" style={styles.textButton}>
                                <Text style={[styles.meta, { color: palette.textMuted }]}>undo</Text>
                            </Pressable>
                        ) : null}
                    </View>
                    <View style={styles.subline}>
                        <Text style={[styles.meta, { color: palette.textMuted }]}>visit {number} · </Text>
                        <Pressable disabled={locked || !editable} onPress={() => { setError(null); setSheet('date'); }} style={styles.textButton} accessibilityRole={editable ? 'button' : undefined}>
                            <Text style={[styles.meta, { color: editable ? palette.primary : palette.textMuted }]}>{current.visited_at ? visitDateLabel(current.visited_at) : editable ? 'add a date' : 'no date'}</Text>
                        </Pressable>
                    </View>
                    {current.note ? <Text numberOfLines={3} style={[styles.note, { color: palette.textSoft }]}>{current.note}</Text> : null}
                    {current.photos.length > 0 ? <View style={styles.thumbs}>
                        {current.photos.slice(0, 5).map((photo, index) => <Pressable key={photo.id} onPress={() => setPhotoIndex(index)} accessibilityRole="button" accessibilityLabel={`Your photo ${index + 1}`}>
                            <Image source={{ uri: photo.url }} style={styles.thumb} />
                        </Pressable>)}
                    </View> : null}
                    {reviewed || !editable ? <View style={styles.plateFoot}>
                        {current.rating != null ? <Text style={[Type.ratingCompact, { color: palette.amberBright }]}>★ {current.rating.toFixed(1)}</Text> : <View />}
                        <Pressable disabled={locked} onPress={() => editable ? setSheet('review') : onOpenVisit(current)} style={styles.textButton} accessibilityRole="button">
                            <Text style={[styles.meta, { color: palette.primary }]}>{editable ? 'edit' : 'view visit'}</Text>
                        </Pressable>
                    </View> : null}
                </View>
            ) : null}
            <View style={styles.buttons}>
                <Pressable onPress={() => void record()} disabled={locked || (!restaurantId && !restaurantPayload)} accessibilityRole="button" accessibilityState={{ disabled: !!locked }}
                    style={({ pressed }) => [styles.button, { backgroundColor: palette.surfaceJournal, opacity: locked ? 0.5 : 1 }, pressed && styles.pressed]}>
                    {mutations.record.isPending ? <ActivityIndicator color={palette.primary} /> : <Ionicons name={current ? 'refresh' : 'checkmark'} size={18} color={palette.primary} />}
                    <Text style={[styles.label, { color: palette.primary }]}>{recordRetry ? 'Retry visit' : current ? 'Been again' : 'Been here'}</Text>
                </Pressable>
                <Pressable disabled={locked || recordRetry} onPress={() => { setError(null); editable && !reviewed ? setSheet('review') : onLog(); }} accessibilityRole="button"
                    style={({ pressed }) => [styles.button, { backgroundColor: palette.primary, opacity: locked || recordRetry ? 0.5 : 1 }, pressed && styles.pressed]}>
                    <Ionicons name="add" size={18} color={palette.textInverse} />
                    <Text style={[styles.label, { color: palette.textInverse }]}>{editable && !reviewed ? 'Add a review' : 'Log this meal'}</Text>
                </Pressable>
            </View>
            {error && !sheet ? <Text accessibilityRole="alert" style={[Type.bodySmall, { color: palette.error }]}>{error}</Text> : null}
            {(sheet === 'history' || sheet === 'date') && current ? <Modal transparent animationType="fade" onRequestClose={close}>
                <View style={[styles.scrim, { backgroundColor: palette.overlay }]}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close visit sheet" />
                    <View style={[styles.sheet, { backgroundColor: palette.background, paddingBottom: insets.bottom + 24 }]}>
                        <View style={styles.sheetHead}>
                            <Text style={[Type.screenTitle, { color: palette.text }]}>{sheet === 'history' ? 'Your visits' : 'Visit date'}</Text>
                            <Pressable disabled={pending} onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={24} color={palette.textMuted} /></Pressable>
                        </View>
                        <Text style={[styles.meta, { color: palette.textMuted, marginBottom: 12 }]}>{restaurantName}{sheet === 'date' ? ` · visit ${number}` : ''}</Text>
                        <ScrollView>
                            {sheet === 'history' ? rows.map((row, index) => (
                                <Pressable key={row.id} onPress={() => { setSelectedId(row.entry_id ?? row.id); close(); }} style={[styles.historyRow, { borderBottomColor: palette.ghostRule }]} accessibilityRole="button" accessibilityState={{ selected: row.id === current.id }}>
                                    <View style={{ flex: 1, gap: 4 }}>
                                        <Text style={[styles.label, { color: palette.text }]}>visit {rows.length - index}</Text>
                                        <Text style={[styles.meta, { color: palette.textMuted }]}>{visitDateLabel(row.visited_at)} · {row.rating != null ? `${row.rating.toFixed(1)}★` : row.note || row.photos.length ? 'review added' : 'no review'}</Text>
                                    </View>
                                    {row.id === current.id ? <Ionicons name="checkmark" size={20} color={palette.primary} /> : null}
                                </Pressable>
                            )) : <>
                                {['No date', 'Today', 'Yesterday', 'Another day'].map((label, index) => <Pressable key={label} disabled={pending} style={styles.dateOption} accessibilityRole="button"
                                    onPress={() => {
                                        if (index === 3) { setChosenDate(current.visited_at ? new Date(current.visited_at) : new Date()); setCalendar(true); return; }
                                        const d = new Date(); if (index === 2) d.setDate(d.getDate() - 1);
                                        void date(index === 0 ? null : d.toISOString());
                                    }}><Text style={[Type.body, { color: palette.text }]}>{label}</Text></Pressable>)}
                                {calendar ? <>
                                    <DateTimePicker value={chosenDate} mode="date" display="inline" maximumDate={new Date()} onChange={(_, value) => { if (value) setChosenDate(value); }} />
                                    <Pressable disabled={pending} onPress={() => void date(chosenDate.toISOString())} style={[styles.button, { backgroundColor: palette.primary }]} accessibilityRole="button"><Text style={[styles.label, { color: palette.textInverse }]}>Save date</Text></Pressable>
                                </> : null}
                            </>}
                            {pending ? <ActivityIndicator color={palette.primary} /> : null}
                            {error ? <Text accessibilityRole="alert" style={[Type.bodySmall, { color: palette.error }]}>{error}</Text> : null}
                        </ScrollView>
                    </View>
                </View>
            </Modal> : null}
            {sheet === 'review' && current?.entry_id && userId ? <VisitReviewSheet key={current.id} visit={current} number={number} restaurantName={restaurantName} userId={userId} palette={palette} onClose={() => setSheet(null)}
                onSave={async (patch) => { await mutations.save.mutateAsync({ entry_id: current.entry_id!, patch }); setUndoId(null); }} /> : null}
            {photoIndex != null && current ? <PhotoLightbox visible photos={current.photos.map((p) => p.url)} initialIndex={photoIndex} caption={`Your visit · ${visitDateLabel(current.visited_at)}`} onClose={() => setPhotoIndex(null)} /> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: { gap: 12 }, plate: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
    plateHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
    count: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, flexShrink: 1 },
    label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, lineHeight: 20, flexShrink: 1 },
    meta: { ...Type.caption }, textButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 },
    subline: { flexDirection: 'row', alignItems: 'center', marginTop: -10, paddingLeft: 24 },
    note: { fontFamily: 'Newsreader_400Regular', fontSize: 16, lineHeight: 22, paddingTop: 8 },
    thumbs: { flexDirection: 'row', gap: 6, paddingTop: 12 }, thumb: { width: 56, height: 56, borderRadius: 4 },
    plateFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    buttons: { flexDirection: 'row', gap: 10 }, button: { minHeight: 52, borderRadius: 10, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 12 },
    pressed: { transform: [{ scale: 0.96 }] },
    scrim: { flex: 1, justifyContent: 'flex-end' }, sheet: { maxHeight: '85%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-end' },
    historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
    dateOption: { minHeight: 48, justifyContent: 'center' },
});
