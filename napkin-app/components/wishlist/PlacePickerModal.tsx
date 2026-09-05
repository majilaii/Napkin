/**
 * PlacePickerModal — search Places and pick one restaurant (b48 amend).
 *
 * Reused by the import batch screen to FIX a mis-resolved spot (re-point) and to
 * ADD a missing one. Self-contained Places search; returns the chosen result.
 *
 * Heirloom Journal: warm paper sheet, italic serif names, quiet meta.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Modal,
    TextInput,
    FlatList,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { callEdgeFn } from '@/lib/edgeInvoke';

export interface PlacePickerResult {
    id: string;
    /** Canonical provider id when `id` is an existing Napkin restaurant UUID. */
    external_id?: string | null;
    /** Server-minted provenance when a search endpoint already evaluated it. */
    resolution_id?: string | null;
    name: string;
    city: string | null;
    cuisine: string | null;
}

function usePlacesSearch(query: string, city?: string | null, visible = true) {
    const [results, setResults] = useState<PlacePickerResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        setResults([]);
        setError(false);
        if (!visible || query.trim().length < 2) {
            setResults([]);
            setIsLoading(false);
            return;
        }
        let cancelled = false;
        setIsLoading(true);
        const timer = setTimeout(() => {
        callEdgeFn<{ data?: PlacePickerResult[] } | PlacePickerResult[]>('places-search', {
            body: { query: query.trim(), limit: 8, ...(city?.trim() ? { city: city.trim() } : {}) },
        })
            .then((res) => {
                if (cancelled) return;
                const list = Array.isArray(res) ? res : ((res as any)?.data ?? []);
                setResults(list.slice(0, 8));
            })
            .catch(() => {
                if (!cancelled) setError(true);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, city, visible, attempt]);

    return { results, isLoading, error, retry: () => setAttempt((value) => value + 1) };
}

interface Props {
    visible: boolean;
    title: string;
    /** Optional one-line murmur under the title. */
    subtitle?: string;
    /** Prefill the search (e.g. the mis-resolved spot's name when fixing) —
     * results appear immediately instead of starting from a blank field. */
    initialQuery?: string;
    /** Imported locality is evidence; do not silently search the owner's home city. */
    city?: string | null;
    busy?: boolean;
    /** Inline error under the input — pageSheets cover the root toast on iOS,
     * so a failed pick must surface HERE (the CorrectModal precedent). */
    errorText?: string | null;
    onSelect: (r: PlacePickerResult) => void;
    onDismiss: () => void;
    palette: typeof Colors.light;
}

export function PlacePickerModal({ visible, title, subtitle, initialQuery, city, busy, errorText, onSelect, onDismiss, palette }: Props) {
    const [query, setQuery] = useState('');
    const [locality, setLocality] = useState(city ?? '');
    const { results, isLoading, error, retry } = usePlacesSearch(query, locality, visible);

    // Each open starts from the prefill (fix mode: the wrong spot's name —
    // usually one edit away from the right one); each close clears it.
    useEffect(() => {
        setQuery(visible ? (initialQuery ?? '') : '');
        setLocality(visible ? (city ?? '') : '');
    }, [visible, initialQuery, city]);

    const handleSelect = useCallback(
        (r: PlacePickerResult) => {
            onSelect(r);
        },
        [onSelect],
    );

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onDismiss}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1, backgroundColor: palette.background }}
            >
                <View style={[styles.header, { borderBottomColor: palette.dividerSoft }]}>
                    <View style={{ flex: 1 }}>
                        <Text style={[Type.sectionTitle, { color: palette.text }]}>{title}</Text>
                        {subtitle ? (
                            <Text style={[Type.body, { color: palette.textMuted, marginTop: Spacing.xs }]}>{subtitle}</Text>
                        ) : null}
                    </View>
                    <Pressable onPress={onDismiss} disabled={busy} style={styles.closeAction} accessibilityRole="button" accessibilityLabel="close place search">
                        <Ionicons name="close" size={24} color={palette.textMuted} />
                    </Pressable>
                </View>

                <View style={styles.inputRow}>
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder="search by name or city"
                        placeholderTextColor={palette.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                        editable={!busy}
                        accessibilityLabel="search for the correct place"
                        style={[styles.input, { color: palette.text, borderBottomColor: palette.ruleInkSoft }]}
                    />
                </View>
                <View style={styles.localityRow}>
                    <Ionicons name="location-outline" size={24} color={palette.textMuted} />
                    <TextInput value={locality} onChangeText={setLocality} editable={!busy}
                        placeholder="town or city" placeholderTextColor={palette.textMuted}
                        accessibilityLabel="town or city for this place" autoCorrect={false}
                        style={[Type.body, styles.localityInput, { color: palette.text }]} />
                </View>

                {errorText ? (
                    <Text
                        style={[
                            Type.body,
                            { color: palette.error, paddingHorizontal: 22, paddingTop: Spacing.sm },
                        ]}
                    >
                        {errorText}
                    </Text>
                ) : null}

                {busy || isLoading ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.lg }} />
                ) : (
                    <FlatList
                        data={results}
                        keyExtractor={(r) => r.id}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: Spacing.sm }}
                        ListEmptyComponent={query.trim().length >= 2 ? (
                            <View style={styles.emptySearch}>
                                <Text style={[Type.body, { color: palette.textMuted }]}>
                                    {error ? 'Could not search places.' : 'No places found. Try another name or town.'}
                                </Text>
                                {error ? <Pressable onPress={retry} style={styles.closeAction} accessibilityRole="button">
                                    <Text style={[Type.body, { color: palette.primary }]}>try again</Text>
                                </Pressable> : null}
                            </View>
                        ) : null}
                        renderItem={({ item: r }) => (
                            <Pressable
                                onPress={() => handleSelect(r)}
                                accessibilityRole="button"
                                accessibilityLabel={`choose ${r.name}${r.city ? ` in ${r.city}` : ''}`}
                                style={[styles.resultRow, { borderBottomColor: palette.dividerSoft }]}
                            >
                                <Text style={[Type.editorialTitle, { color: palette.text }]}>{r.name}</Text>
                                {r.city || r.cuisine ? (
                                    <Text style={[Type.metadata, { color: palette.textMuted }]}>
                                        {[r.city, r.cuisine].filter(Boolean).join(' · ')}
                                    </Text>
                                ) : null}
                            </Pressable>
                        )}
                    />
                )}
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    closeAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    localityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
    localityInput: { flex: 1, minHeight: 44 },
    emptySearch: { paddingTop: Spacing.lg, gap: Spacing.sm },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 12,
    },
    inputRow: { paddingHorizontal: 22, paddingTop: Spacing.sm },
    input: { fontSize: 15, paddingVertical: 8, borderBottomWidth: 1 },
    resultRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
