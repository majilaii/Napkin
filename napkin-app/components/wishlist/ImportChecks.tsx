/** Owner-only checks for one saved import, using the existing correction protocol. */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import {
    type ExhaustedCompletenessItem,
    useCorrectCompletenessItem,
    useDismissCompletenessItem,
    useRetryCompletenessItem,
} from '@/hooks/imports/useCompletenessRetries';
import { mintImportMatchCorrection } from '@/lib/importResolution';
import { PlacePickerModal, type PlacePickerResult } from './PlacePickerModal';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATCH_REASONS = new Set(['locality_reject', 'name_reject', 'ambiguous', 'no_result', 'type_rejected']);

export function importCheckExplanation(reason: string | null): string {
    switch (reason) {
        case 'locality_reject': return 'The location could not be confirmed.';
        case 'name_reject': return 'The place name could not be matched confidently.';
        case 'ambiguous': return 'Several places looked similar. Choose the one from your clip.';
        case 'no_result': return 'No confident match was found for this place.';
        case 'type_rejected': return 'The listing could not be confirmed as a food or drink spot.';
        default: return 'Napkin could not finish checking this place’s details.';
    }
}

type Props = {
    userId: string;
    items: ExhaustedCompletenessItem[];
    savedRestaurantIds: Set<string>;
    palette: typeof Colors.light;
    loading: boolean;
    error: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    onRetryLoad: () => void;
    onLoadMore: () => void;
};

export function ImportChecks({ userId, items, savedRestaurantIds, palette,
    loading, error, hasMore, loadingMore, onRetryLoad, onLoadMore }: Props) {
    const correct = useCorrectCompletenessItem(userId);
    const dismiss = useDismissCompletenessItem(userId);
    const retry = useRetryCompletenessItem(userId);
    const [picker, setPicker] = useState<ExhaustedCompletenessItem | null>(null);
    const [pickerError, setPickerError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    // Hooks optimistically remove rows. Retain the active card until the server
    // confirms so a failed request cannot masquerade as a completed check.
    const [activeItem, setActiveItem] = useState<ExhaustedCompletenessItem | null>(null);
    const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const inFlight = useRef(false);
    const displayedItems = activeItem && !items.some((item) => item.id === activeItem.id)
        ? [activeItem, ...items] : items;

    const actOnCheck = async (item: ExhaustedCompletenessItem, action: 'retry' | 'dismiss') => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusyId(item.id);
        setActiveItem(item);
        setActionError(null);
        setNotice(null);
        try {
            if (action === 'retry') {
                await retry.mutateAsync(item.id);
                setNotice('Matching restarted. This check may return if a match is still uncertain.');
            } else {
                await dismiss.mutateAsync(item.id);
                setNotice(item.restaurant_id && savedRestaurantIds.has(item.restaurant_id)
                    ? 'Check cleared. Your saved place is unchanged.' : 'Check cleared.');
            }
        } catch {
            setActionError({ id: item.id, message: 'Could not update this check. Try again.' });
        } finally {
            inFlight.current = false;
            setBusyId(null);
            setActiveItem(null);
        }
    };

    const pickMatch = async (result: PlacePickerResult) => {
        const item = picker;
        if (!item?.import_nonce || inFlight.current) return;
        const externalId = result.external_id ?? (UUID_RE.test(result.id) ? null : result.id);
        if (!externalId) {
            setPickerError('This listing could not be verified. Choose another result.');
            return;
        }
        inFlight.current = true;
        setBusyId(item.id);
        setActiveItem(item);
        setPickerError(null);
        setNotice(null);
        try {
            const resolutionId = await mintImportMatchCorrection({
                import_nonce: item.import_nonce,
                prior_resolution_id: item.resolution_id ?? null,
                chosen_external_id: externalId,
                expected_owner_id: userId,
            });
            await correct.mutateAsync({ item_id: item.id, resolution_id: resolutionId });
            setPicker(null);
            setNotice(`Match chosen: ${result.name}. Place details will update when matching finishes.`);
        } catch {
            setPickerError('Could not verify this match. Try again or choose another result.');
        } finally {
            inFlight.current = false;
            setBusyId(null);
            setActiveItem(null);
        }
    };

    const action = (label: string, onPress: () => void, primary = false, disabled = false) => (
        <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
            accessibilityLabel={label} accessibilityState={{ disabled }}
            style={({ pressed }) => [styles.action, primary && { backgroundColor: palette.primary },
                { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}>
            <Text style={[Type.body, styles.actionText,
                { color: primary ? palette.textInverse : palette.primary }]}>{label}</Text>
        </Pressable>
    );

    return (
        <View style={styles.section}>
            {loading ? <ActivityIndicator accessibilityLabel="loading place checks" color={palette.primary} /> : null}
            {error ? <View style={styles.status}>
                <Text style={[Type.body, { color: palette.text }]}>Could not load place checks.</Text>
                {action('reload checks', onRetryLoad)}
            </View> : null}
            {notice ? <View style={[styles.status, { backgroundColor: palette.surfaceJournalLow }]} accessibilityLiveRegion="polite">
                <Text style={[Type.body, { color: palette.text }]}>{notice}</Text>
            </View> : null}
            {displayedItems.length > 0 ? <View style={styles.intro}>
                <Text style={[Type.sectionTitle, { color: palette.text }]}>
                    {displayedItems.length === 1 ? '1 place to check' : `${displayedItems.length} places to check`}
                </Text>
                <Text style={[Type.body, { color: palette.textMuted }]}>Choose a listing to finish matching this clip.</Text>
            </View> : !loading && !error && !hasMore && !notice ? (
                <Text style={[Type.metadata, { color: palette.textMuted }]}>No place checks waiting.</Text>
            ) : null}
            {displayedItems.map((item) => {
                const saved = !!item.restaurant_id && savedRestaurantIds.has(item.restaurant_id);
                const busy = busyId === item.id;
                return <View key={item.id} style={[styles.card, { backgroundColor: palette.surfaceNote }]}>
                    <View style={styles.statusLabel}>
                        <Ionicons name="location-outline" size={20} color={palette.amberInk} />
                        <Text style={[Type.sectionKicker, { color: palette.amberInk }]}>details not confirmed</Text>
                    </View>
                    <Text style={[Type.editorialTitle, { color: palette.text }]}>{item.restaurant_name ?? 'Place from your clip'}</Text>
                    {item.restaurant_city ? <Text style={[Type.metadata, { color: palette.textMuted }]}>{item.restaurant_city}</Text> : null}
                    <Text style={[Type.body, styles.explanation, { color: palette.text }]}>{importCheckExplanation(item.last_error)}</Text>
                    {busy ? <ActivityIndicator accessibilityLabel="updating place check" color={palette.primary} /> : null}
                    {actionError?.id === item.id ? <Text accessibilityRole="alert" style={[Type.body, { color: palette.primary }]}>{actionError.message}</Text> : null}
                    {item.import_nonce ? action('find correct place', () => {
                        if (inFlight.current) return;
                        setPickerError(null);
                        setPicker(item);
                    }, true, busyId !== null) : null}
                    {!MATCH_REASONS.has(item.last_error ?? '') || !item.import_nonce
                        ? action('try matching again', () => void actOnCheck(item, 'retry'), !item.import_nonce, busyId !== null) : null}
                    {action(saved ? 'keep as saved' : 'dismiss check', () => void actOnCheck(item, 'dismiss'), false, busyId !== null)}
                    <Text style={[Type.metadata, styles.keepHint, { color: palette.textMuted }]}>
                        {saved ? 'Keeps your saved place and clears this check.' : 'Stops checking this place. Nothing is deleted.'}
                    </Text>
                </View>;
            })}
            {hasMore ? action(loadingMore ? 'loading more checks…' : 'load more checks', onLoadMore, false, loadingMore) : null}
            <PlacePickerModal visible={picker !== null} title="Find the correct place"
                subtitle="Choose the listing that matches the name and town in your clip."
                initialQuery={picker?.restaurant_name ?? ''} city={picker?.restaurant_city}
                busy={busyId !== null} errorText={pickerError} onSelect={pickMatch}
                onDismiss={() => { if (!inFlight.current) { setPicker(null); setPickerError(null); } }}
                palette={palette} />
        </View>
    );
}

const styles = StyleSheet.create({
    section: { gap: Spacing.md, marginTop: Spacing.lg },
    intro: { gap: Spacing.xs },
    card: { padding: Spacing.md, borderRadius: Radius.lg, gap: Spacing.xs },
    statusLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
    explanation: { marginVertical: Spacing.sm },
    action: { minHeight: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
    actionText: { fontFamily: 'Manrope_600SemiBold' },
    keepHint: { textAlign: 'center' },
    status: { padding: Spacing.md, borderRadius: Radius.md, gap: Spacing.xs },
});
