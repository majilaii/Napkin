/**
 * FastLogForm — canonical Fast Log (Heirloom kit).
 *
 * Reached ONLY from the restaurant page via FastLogSheet. The restaurant is
 * always locked — there is no search path here. The + tab button opens the
 * full composer (/create-entry) instead.
 *
 * Canvas source: napkin-design-system/project/ui_kits/napkin-app/logger-canvas.html
 * Section 1 "Fast Log canonical" + progressive-disclosure "Break it down".
 *
 * Layout (top → bottom, single column):
 *   RestaurantHeader (locked)
 *   Stars (34px) + caption ("Really good · 4.5 / 5")
 *   Hairline
 *   FieldUnderline note ("a line about it (optional)")
 *   Hairline
 *   "Post to" chip row
 *   "+ Break it down" — TOGGLES an in-place expansion that reveals 4 axis
 *     rows (Food / Vibe / Service / Value). Closing the section zeros nothing
 *     — axis state persists across the toggle.
 *   LOG IT pill
 *   "open full entry →" — escape hatch to the composer for photos / companions.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { useTables } from '@/hooks/tables/useTables';
import { StarRating } from '@/components/StarRating';
import { supabase } from '@/lib/supabase';
import {
    RestaurantHeader,
    FieldUnderline,
    Chip,
    Label,
} from '@/components/ui';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LockedRestaurant {
    /** Napkin UUID — present if the restaurant is persisted */
    id?: string;
    /** Google Place ID — present for ghost restaurants */
    external_id?: string;
    name: string;
    /** Full Places payload for passing to create-entry as placePayload */
    placePayload?: any;
}

export interface FastLogFormProps {
    /** Required — FastLogForm always runs in locked mode. */
    lockedRestaurant: LockedRestaurant;
    initialTableId?: string;
    onSubmitted: (entryId: string) => void;
    /** Route to full composer via the explicit "open full entry →" link. */
    onOpenFullEntry: (prefill: {
        rating: number;
        axes: { food: number; vibe: number; service: number; value: number };
        lockedRestaurant: LockedRestaurant;
        tableId: string | null;
        note: string;
    }) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function ratingCaption(value: number): { phrase: string | null; numeric: string | null } {
    if (value <= 0) return { phrase: null, numeric: 'Tap a star' };
    const snapped = Math.round(value * 2) / 2;
    const phrase =
        snapped >= 5
            ? 'Loved it'
            : snapped >= 4
              ? 'Really good'
              : snapped >= 3
                ? 'Pretty good'
                : snapped >= 2
                  ? 'Okay'
                  : 'Not my thing';
    return { phrase, numeric: `${snapped} / 5` };
}

function metaFromLocked(r: LockedRestaurant): string | undefined {
    const pp = r.placePayload;
    if (!pp) return undefined;
    return pp.formattedAddress ?? undefined;
}

function photoFromLocked(r: LockedRestaurant): string | null {
    const ref = r.placePayload?.photoReference;
    if (!ref) return null;
    const supabaseUrl = (supabase as any).supabaseUrl as string | undefined;
    if (!supabaseUrl) return null;
    return `${supabaseUrl}/functions/v1/places-photo?ref=${encodeURIComponent(ref)}`;
}

// ── AxisRow — inline sub-axis rating ─────────────────────────────────────────

interface AxisRowProps {
    label: string;
    value: number;
    onChange: (v: number) => void;
}

function AxisRow({ label, value, onChange }: AxisRowProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    return (
        <View style={axisStyles.row}>
            <Text
                style={[
                    axisStyles.label,
                    { color: palette.textSecondary },
                ]}
            >
                {label}
            </Text>
            <View style={axisStyles.stars}>
                <StarRating
                    value={value}
                    size={18}
                    editable
                    onChange={onChange}
                    showValue={false}
                />
            </View>
            <Text
                style={{
                    fontFamily: 'Newsreader_400Regular_Italic',
                    fontSize: 16,
                    color: value > 0 ? palette.text : palette.textMuted,
                    minWidth: 28,
                    textAlign: 'right',
                }}
            >
                {value > 0 ? value.toFixed(1) : '—'}
            </Text>
        </View>
    );
}

const axisStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
    },
    label: {
        width: 80,
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    stars: {
        flex: 1,
    },
});

// ── Component ─────────────────────────────────────────────────────────────────

export function FastLogForm({
    lockedRestaurant,
    initialTableId,
    onSubmitted,
    onOpenFullEntry,
}: FastLogFormProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();

    // ── Tables ────────────────────────────────────────────────────────────
    const { data: tableMemberships } = useTables(user?.id);
    const tables = (tableMemberships ?? []).map(m => m.tables);
    const sortedTables = [...tables].sort((a, b) => a.name.localeCompare(b.name));
    const defaultTableId = initialTableId ?? sortedTables[0]?.id ?? null;
    const [selectedTableId, setSelectedTableId] = useState<string | null>(defaultTableId);

    useEffect(() => {
        if (!selectedTableId && defaultTableId) {
            setSelectedTableId(defaultTableId);
        }
    }, [defaultTableId, selectedTableId]);

    // ── Rating + note + axes ──────────────────────────────────────────────
    const [rating, setRating] = useState(0);
    const [note, setNote] = useState('');
    const [expanded, setExpanded] = useState(false);
    const [foodRating, setFoodRating] = useState(0);
    const [vibeRating, setVibeRating] = useState(0);
    const [serviceRating, setServiceRating] = useState(0);
    const [valueRating, setValueRating] = useState(0);

    // ── Submit ────────────────────────────────────────────────────────────
    const createEntry = useCreateEntry(user?.id, selectedTableId);

    const canSubmit = rating > 0;
    const isSubmitting = createEntry.isPending;
    const [submitError, setSubmitError] = useState<string | null>(null);

    const handleSubmit = useCallback(async () => {
        if (!canSubmit || isSubmitting) return;
        setSubmitError(null);

        let restaurantData: any;
        const payload = lockedRestaurant.placePayload;
        if (payload) {
            restaurantData = {
                external_id: payload.id ?? payload.external_id ?? lockedRestaurant.external_id ?? '',
                name: payload.name ?? lockedRestaurant.name,
                location: payload.formattedAddress
                    ? { address: payload.formattedAddress }
                    : undefined,
                types: payload.categories ?? ['restaurant'],
                latitude: payload.latitude ?? undefined,
                longitude: payload.longitude ?? undefined,
                photoReference: payload.photoReference ?? undefined,
            };
        } else {
            restaurantData = {
                external_id: lockedRestaurant.external_id ?? lockedRestaurant.id ?? `manual-${Date.now()}`,
                name: lockedRestaurant.name,
                types: ['restaurant'],
            };
        }

        const ratingValue = Math.round(rating * 2) / 2;

        try {
            const result = await createEntry.mutateAsync({
                restaurant: restaurantData,
                rating: ratingValue,
                table_id: selectedTableId ?? undefined,
                visibility: selectedTableId ? 'table' : 'private',
                content: note.trim() || undefined,
                flavor_rating: foodRating > 0 ? foodRating : undefined,
                vibe_rating: vibeRating > 0 ? vibeRating : undefined,
                service_rating: serviceRating > 0 ? serviceRating : undefined,
                value_rating: valueRating > 0 ? valueRating : undefined,
            });
            const entryId = result?.id ?? result?.entry?.id ?? '';
            onSubmitted(entryId);
        } catch (e: any) {
            setSubmitError(e.message ?? 'Could not save entry. Tap to retry.');
        }
    }, [
        canSubmit,
        isSubmitting,
        lockedRestaurant,
        rating,
        note,
        foodRating,
        vibeRating,
        serviceRating,
        valueRating,
        selectedTableId,
        createEntry,
        onSubmitted,
    ]);

    const handleOpenFullEntry = useCallback(() => {
        if (createEntry.isPending || createEntry.isSuccess) return;
        onOpenFullEntry({
            rating,
            axes: {
                food: foodRating,
                vibe: vibeRating,
                service: serviceRating,
                value: valueRating,
            },
            lockedRestaurant,
            tableId: selectedTableId,
            note,
        });
    }, [
        rating,
        foodRating,
        vibeRating,
        serviceRating,
        valueRating,
        lockedRestaurant,
        selectedTableId,
        note,
        createEntry.isPending,
        createEntry.isSuccess,
        onOpenFullEntry,
    ]);

    // ── Render ────────────────────────────────────────────────────────────

    const caption = ratingCaption(rating);
    const restaurantPhoto = photoFromLocked(lockedRestaurant);
    const restaurantMeta = metaFromLocked(lockedRestaurant);

    return (
        <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
        >
            <RestaurantHeader
                name={lockedRestaurant.name}
                meta={restaurantMeta}
                photoUrl={restaurantPhoto}
                locked
            />

            <View style={styles.ratingBlock}>
                <StarRating
                    value={rating}
                    size={34}
                    editable
                    onChange={setRating}
                    showValue={false}
                />
                <View style={styles.captionRow}>
                    {caption.phrase ? (
                        <Text
                            style={{
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontSize: 15,
                                color: palette.text,
                                marginRight: 8,
                            }}
                        >
                            {caption.phrase}
                        </Text>
                    ) : null}
                    {caption.numeric ? (
                        <Text
                            style={{
                                fontFamily: 'Manrope_700Bold',
                                fontSize: 11,
                                color: palette.textMuted,
                                letterSpacing: 0.6,
                                textTransform: 'uppercase',
                            }}
                        >
                            {caption.numeric}
                        </Text>
                    ) : null}
                </View>
            </View>

            <View style={[styles.hairline, { backgroundColor: palette.dividerSoft }]} />

            <FieldUnderline
                placeholder="a line about it (optional)"
                value={note}
                onChangeText={setNote}
                fontVariant="serif"
                size="body"
                containerStyle={styles.noteField}
                returnKeyType="done"
                maxLength={280}
            />

            <View
                style={[
                    styles.hairline,
                    { backgroundColor: palette.dividerSoft, marginTop: Spacing.md },
                ]}
            />

            {sortedTables.length > 0 ? (
                <View style={styles.postToBlock}>
                    <Label color={palette.textMuted}>Post to</Label>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipRow}
                    >
                        {sortedTables.map(t => (
                            <Chip
                                key={t.id}
                                active={selectedTableId === t.id}
                                onPress={() => setSelectedTableId(t.id)}
                            >
                                {t.name}
                            </Chip>
                        ))}
                    </ScrollView>
                </View>
            ) : null}

            <Pressable
                onPress={() => setExpanded(v => !v)}
                hitSlop={6}
                style={({ pressed }) => [
                    styles.breakItDown,
                    { opacity: pressed ? 0.6 : 1 },
                ]}
            >
                <Ionicons
                    name={expanded ? 'remove' : 'add'}
                    size={14}
                    color={palette.primary}
                    style={{ marginRight: 4 }}
                />
                <Text
                    style={{
                        fontFamily: 'Manrope_500Medium',
                        fontSize: 12,
                        color: palette.primary,
                    }}
                >
                    {expanded ? 'Hide the breakdown' : 'Break it down'}
                </Text>
            </Pressable>

            {expanded ? (
                <View style={styles.axesBlock}>
                    <AxisRow label="Food" value={foodRating} onChange={setFoodRating} />
                    <AxisRow label="Vibe" value={vibeRating} onChange={setVibeRating} />
                    <AxisRow label="Service" value={serviceRating} onChange={setServiceRating} />
                    <AxisRow label="Value" value={valueRating} onChange={setValueRating} />
                    <Text
                        style={[
                            styles.axesHint,
                            { color: palette.textMuted },
                        ]}
                    >
                        Sub-scores are independent — they don&apos;t need to average to your overall.
                    </Text>
                </View>
            ) : null}

            {submitError ? (
                <View style={styles.errorRow}>
                    <Text style={[Type.bodySmall, { color: palette.error }]}>
                        {submitError}
                    </Text>
                    <Pressable onPress={handleSubmit}>
                        <Text
                            style={[
                                Type.caption,
                                {
                                    color: palette.error,
                                    textDecorationLine: 'underline',
                                    marginLeft: Spacing.xs,
                                },
                            ]}
                        >
                            Retry
                        </Text>
                    </Pressable>
                </View>
            ) : null}

            <Pressable
                disabled={!canSubmit || isSubmitting}
                onPress={handleSubmit}
                style={({ pressed }) => [
                    styles.ctaButton,
                    {
                        backgroundColor: canSubmit
                            ? palette.primary
                            : palette.surfaceContainerHigh,
                        opacity: pressed ? 0.9 : isSubmitting ? 0.6 : 1,
                    },
                ]}
            >
                {isSubmitting ? (
                    <ActivityIndicator color={palette.textInverse} />
                ) : (
                    <Text
                        style={[
                            Type.label,
                            {
                                color: canSubmit ? palette.textInverse : palette.textMuted,
                                letterSpacing: 1.5,
                            },
                        ]}
                    >
                        LOG IT
                    </Text>
                )}
            </Pressable>

            <Pressable
                onPress={handleOpenFullEntry}
                disabled={createEntry.isPending || createEntry.isSuccess}
                hitSlop={6}
                style={({ pressed }) => [
                    styles.openFullEntry,
                    {
                        opacity:
                            pressed || createEntry.isPending || createEntry.isSuccess ? 0.5 : 1,
                    },
                ]}
            >
                <Text
                    style={{
                        fontFamily: 'Manrope_500Medium',
                        fontSize: 12,
                        color: palette.textSecondary,
                    }}
                >
                    Want photos, dish notes, companions?{'  '}
                </Text>
                <Text
                    style={{
                        fontFamily: 'Manrope_600SemiBold',
                        fontSize: 12,
                        color: palette.primary,
                    }}
                >
                    open full entry →
                </Text>
            </Pressable>
        </ScrollView>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const PAGE_H = 20;

const styles = StyleSheet.create({
    scrollContent: {
        paddingHorizontal: PAGE_H,
        paddingTop: 18,
        paddingBottom: Spacing.xl,
    },
    ratingBlock: {
        marginTop: 26,
        gap: 10,
    },
    captionRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    hairline: {
        height: StyleSheet.hairlineWidth,
        marginTop: 20,
    },
    noteField: {
        marginTop: 16,
    },
    postToBlock: {
        marginTop: 18,
        gap: Spacing.sm,
    },
    chipRow: {
        gap: 8,
        paddingRight: Spacing.sm,
    },
    breakItDown: {
        alignSelf: 'flex-start',
        marginTop: 22,
        flexDirection: 'row',
        alignItems: 'center',
    },
    axesBlock: {
        marginTop: 10,
    },
    axesHint: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        lineHeight: 18,
        marginTop: 6,
    },
    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginTop: Spacing.md,
    },
    ctaButton: {
        marginTop: Spacing.xl,
        height: 50,
        borderRadius: 9999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    openFullEntry: {
        marginTop: 14,
        paddingVertical: 6,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
    },
});
