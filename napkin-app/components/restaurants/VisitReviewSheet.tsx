import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Type } from '@/constants/theme';
import { StarRating } from '@/components/StarRating';
import { compressAndUpload } from '@/lib/imageUpload';
import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';
import type { VisitPatch } from '@/hooks/restaurants/useRestaurantVisitMutations';

type DraftPhoto = { uri: string; approvedUrl?: string };

/** Stage only on Save. Keep successful stages for a retry; bind in the save transaction. */
export async function stageVisitPhotos(photos: DraftPhoto[], userId: string, upload = compressAndUpload) {
    const urls: string[] = [];
    for (const photo of photos) {
        if (!photo.approvedUrl) photo.approvedUrl = await upload(photo.uri, userId);
        urls.push(photo.approvedUrl);
    }
    return urls;
}

export function VisitReviewSheet({ visit, number, restaurantName, userId, palette, onClose, onSave }: {
    visit: SelfLogRow; number: number; restaurantName: string; userId: string;
    palette: typeof Colors.light; onClose: () => void;
    onSave: (patch: VisitPatch) => Promise<void>;
}) {
    const insets = useSafeAreaInsets();
    const [rating, setRating] = useState(visit.rating ?? 0);
    const [note, setNote] = useState(visit.note ?? '');
    const [photos, setPhotos] = useState<DraftPhoto[]>(visit.photos.map((p) => ({ uri: p.url, approvedUrl: p.url })));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const saving = useRef(false);
    const pickerOpen = useRef(false);
    const pick = async () => {
        if (saving.current || pickerOpen.current) return;
        pickerOpen.current = true;
        setError(null);
        try {
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10 - photos.length, quality: 1 });
            if (!result.canceled) setPhotos((old) => [...old, ...result.assets.map((a) => ({ uri: a.uri }))].slice(0, 10));
        } catch {
            setError('Couldn’t open your photos. Please try again.');
        } finally { pickerOpen.current = false; }
    };
    const save = async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        setError(null);
        try {
            const photoUrls = await stageVisitPhotos(photos, userId);
            const photosChanged = photoUrls.length !== visit.photos.length || photoUrls.some((url, i) => url !== visit.photos[i]?.url);
            await onSave({ rating: rating || null, content: note.trim() || null, ...(photosChanged ? { photo_urls: photoUrls } : {}) });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Couldn’t save your review. Please try again.');
        } finally { saving.current = false; setBusy(false); }
    };
    const date = visit.visited_at ? new Date(visit.visited_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'no date';
    return (
        <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!saving.current) onClose(); }}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, { backgroundColor: palette.background }]}>
                <View style={styles.nav}>
                    <Pressable disabled={busy} onPress={onClose} style={styles.navButton} accessibilityRole="button"><Text style={[styles.action, { color: palette.textMuted, opacity: busy ? 0.4 : 1 }]}>Cancel</Text></Pressable>
                    <Text style={[Type.screenTitle, { color: palette.text }]}>Your review</Text>
                    <Pressable disabled={busy} onPress={() => void save()} style={styles.navButton} accessibilityRole="button" accessibilityLabel="Save review">
                        {busy ? <ActivityIndicator color={palette.primary} /> : <Text style={[styles.action, { color: palette.primary }]}>Save</Text>}
                    </Pressable>
                </View>
                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
                    <Text style={[Type.caption, { color: palette.textMuted }]}>{restaurantName} · visit {number} · {date}</Text>
                    <View style={styles.ratingRow} pointerEvents={busy ? 'none' : 'auto'}>
                        <StarRating value={rating} editable size={36} color={palette.amberBright} onChange={(v) => setRating(v === rating ? 0 : v)} />
                        <Text style={[Type.caption, { color: palette.textMuted }]}>{rating ? `${rating.toFixed(1)} / 5` : 'optional'}</Text>
                    </View>
                    <TextInput multiline editable={!busy} value={note} onChangeText={setNote} maxLength={10000}
                        placeholder="What stayed with you?" placeholderTextColor={palette.textFaint}
                        accessibilityLabel="Your review, optional" style={[styles.note, { color: palette.text }]} textAlignVertical="top" />
                    <View style={styles.photos}>
                        {photos.map((photo, index) => (
                            <View key={`${photo.uri}-${index}`} style={styles.photo}>
                                <Image source={{ uri: photo.uri }} style={styles.image} />
                                <Pressable disabled={busy} onPress={() => setPhotos((old) => old.filter((_, i) => i !== index))}
                                    style={styles.remove} accessibilityRole="button" accessibilityLabel={`Remove photo ${index + 1}`}>
                                    <View style={[styles.removeDot, { backgroundColor: palette.card }]}><Ionicons name="close" size={12} color={palette.text} /></View>
                                </Pressable>
                            </View>
                        ))}
                        {photos.length < 10 ? <Pressable disabled={busy} onPress={() => void pick()} accessibilityRole="button" accessibilityLabel="Add photos"
                            style={[styles.addPhoto, { backgroundColor: palette.surfaceJournal, opacity: busy ? 0.5 : 1 }]}>
                            <Ionicons name="camera-outline" size={24} color={palette.primary} /><Text style={[Type.caption, { color: palette.primary }]}>add photo</Text>
                        </Pressable> : null}
                    </View>
                    {error ? <Text accessibilityRole="alert" style={[Type.bodySmall, { color: palette.error }]}>{error}</Text> : null}
                    {busy ? <Text style={[Type.caption, { color: palette.textMuted }]}>Saving your review…</Text> : null}
                </ScrollView>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    navButton: { minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center' },
    action: { ...Type.caption, fontFamily: 'Manrope_600SemiBold' },
    content: { padding: 24, gap: 24 },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
    note: { fontFamily: 'Newsreader_400Regular', fontSize: 20, lineHeight: 29, minHeight: 160, padding: 0 },
    photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    photo: { width: 84, height: 84 },
    image: { width: 84, height: 84, borderRadius: 6 },
    remove: { position: 'absolute', top: -12, right: -12, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    removeDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    addPhoto: { width: 84, height: 84, borderRadius: 6, alignItems: 'center', justifyContent: 'center', gap: 6 },
});
