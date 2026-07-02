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
    name: string;
    city: string | null;
    cuisine: string | null;
}

function usePlacesSearch(query: string) {
    const [results, setResults] = useState<PlacePickerResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (query.trim().length < 2) {
            setResults([]);
            return;
        }
        let cancelled = false;
        setIsLoading(true);
        callEdgeFn<{ data?: PlacePickerResult[] } | PlacePickerResult[]>('places-search', {
            body: { query: query.trim(), limit: 8 },
        })
            .then((res) => {
                if (cancelled) return;
                const list = Array.isArray(res) ? res : ((res as any)?.data ?? []);
                setResults(list.slice(0, 8));
            })
            .catch(() => {
                if (!cancelled) setResults([]);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [query]);

    return { results, isLoading };
}

interface Props {
    visible: boolean;
    title: string;
    /** Optional one-line murmur under the title. */
    subtitle?: string;
    /** Prefill the search (e.g. the mis-resolved spot's name when fixing) —
     * results appear immediately instead of starting from a blank field. */
    initialQuery?: string;
    busy?: boolean;
    onSelect: (r: PlacePickerResult) => void;
    onDismiss: () => void;
    palette: typeof Colors.light;
}

export function PlacePickerModal({ visible, title, subtitle, initialQuery, busy, onSelect, onDismiss, palette }: Props) {
    const [query, setQuery] = useState('');
    const { results, isLoading } = usePlacesSearch(query);

    // Each open starts from the prefill (fix mode: the wrong spot's name —
    // usually one edit away from the right one); each close clears it.
    useEffect(() => {
        setQuery(visible ? (initialQuery ?? '') : '');
    }, [visible, initialQuery]);

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
                        <Text style={[Type.headlineItalic, { color: palette.text, fontSize: 17 }]}>{title}</Text>
                        {subtitle ? (
                            <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>{subtitle}</Text>
                        ) : null}
                    </View>
                    <Pressable onPress={onDismiss} hitSlop={12}>
                        <Ionicons name="close" size={22} color={palette.textMuted} />
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
                        style={[styles.input, { color: palette.text, borderBottomColor: palette.ruleInkSoft }]}
                    />
                </View>

                {busy || isLoading ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.lg }} />
                ) : (
                    <FlatList
                        data={results}
                        keyExtractor={(r) => r.id}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: Spacing.sm }}
                        renderItem={({ item: r }) => (
                            <Pressable
                                onPress={() => handleSelect(r)}
                                style={[styles.resultRow, { borderBottomColor: palette.dividerSoft }]}
                            >
                                <Text style={[Type.headlineItalic, { color: palette.text, fontSize: 15 }]}>{r.name}</Text>
                                {r.city || r.cuisine ? (
                                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
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
