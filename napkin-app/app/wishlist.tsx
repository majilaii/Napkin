/**
 * /wishlist — personal wishlist, grouped by city (Heirloom Journal wireframe).
 * Reached from Settings → "My Wishlist".
 *
 * TICKET-060: renders PendingSaveCard rows at top for pending/needs_confirm captures.
 * Wires useCorrectImport for one-tap correction from needs_confirm state.
 */
import React, { useCallback, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { WishlistByCity, ImportLinkSheet, PendingSaveCard } from '@/components/wishlist';
import { useMyWishlist, type PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import { useCorrectImport } from '@/hooks/wishlist/useCorrectImport';
import { callEdgeFn } from '@/lib/edgeInvoke';

// ── Inline search for correction ───────────────────────────────────────────────

interface SearchResult {
    id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
}

// [TICKET-060 B3] places-search is POST-only (405 on GET → empty results).
// Use POST body instead of GET params.
function usePlacesSearch(query: string) {
    const [results, setResults] = React.useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);

    React.useEffect(() => {
        if (query.trim().length < 2) {
            setResults([]);
            return;
        }
        let cancelled = false;
        setIsLoading(true);
        callEdgeFn<{ data?: SearchResult[] } | SearchResult[]>('places-search', {
            body: { query: query.trim(), limit: 8 },
        })
            .then((res) => {
                if (cancelled) return;
                // places-search returns { data: [...] } or an array directly
                const list = Array.isArray(res) ? res : ((res as any)?.data ?? []);
                setResults(list.slice(0, 8));
            })
            .catch(() => {
                if (!cancelled) setResults([]);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });
        return () => { cancelled = true; };
    }, [query]);

    return { results, isLoading };
}

// ── Correction modal ───────────────────────────────────────────────────────────

interface CorrectModalProps {
    visible: boolean;
    item: PersonalWishlistItem | null;
    userId: string;
    onDone: () => void;
    palette: typeof Colors.light;
}

function CorrectModal({ visible, item, userId, onDone, palette }: CorrectModalProps) {
    const [query, setQuery] = useState('');
    const { results, isLoading } = usePlacesSearch(query);
    const { mutate: correct, isPending } = useCorrectImport(userId);

    const handleSelect = useCallback((r: SearchResult) => {
        if (!item?.job_id) return;
        correct(
            { job_id: item.job_id, restaurant_id: r.id, restaurantName: r.name ?? undefined },
            {
                onSettled: () => {
                    setQuery('');
                    onDone();
                },
            },
        );
    }, [correct, item, onDone]);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onDone}
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1, backgroundColor: palette.background }}
            >
                <View style={[correctStyles.header, { borderBottomColor: palette.dividerSoft }]}>
                    <Text style={[Type.headlineItalic, { color: palette.text, fontSize: 17 }]}>
                        find the right one
                    </Text>
                    <Pressable onPress={onDone} hitSlop={12}>
                        <Ionicons name="close" size={22} color={palette.textMuted} />
                    </Pressable>
                </View>
                <View style={correctStyles.inputRow}>
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder="search by name or city"
                        placeholderTextColor={palette.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                        style={[
                            correctStyles.input,
                            { color: palette.text, borderBottomColor: palette.ruleInkSoft },
                        ]}
                    />
                </View>
                {isPending ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.lg }} />
                ) : isLoading ? (
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
                                style={[
                                    correctStyles.resultRow,
                                    { borderBottomColor: palette.dividerSoft },
                                ]}
                            >
                                <Text style={[Type.headlineItalic, { color: palette.text, fontSize: 15 }]}>
                                    {r.name}
                                </Text>
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

const correctStyles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    inputRow: {
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
    },
    input: {
        fontSize: 15,
        paddingVertical: 8,
        borderBottomWidth: 1,
    },
    resultRow: {
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
});

// ── Main screen ────────────────────────────────────────────────────────────────

export default function WishlistScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [importSheetVisible, setImportSheetVisible] = useState(false);
    const [correctItem, setCorrectItem] = useState<PersonalWishlistItem | null>(null);

    // Fetch wishlist to surface pending rows
    const { data: wishlistPages } = useMyWishlist(user?.id);

    // Collect all pages' items, extract pending/needs_confirm rows
    const pendingRows = useMemo(() => {
        const allItems = (wishlistPages?.pages ?? []).flatMap((p) => p.data ?? []);
        return allItems.filter(
            (item) =>
                item.extraction_status === 'pending' ||
                item.extraction_status === 'needs_confirm',
        );
    }, [wishlistPages]);

    const handleConfirm = useCallback((item: PersonalWishlistItem) => {
        setCorrectItem(item);
    }, []);

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
            <Stack.Screen options={{ headerShown: false }} />
            <View
                style={[
                    styles.header,
                    {
                        backgroundColor: palette.background,
                        paddingTop: insets.top + Spacing.sm,
                    },
                ]}
            >
                <Pressable
                    onPress={() => router.back()}
                    hitSlop={12}
                    style={styles.headerSide}
                >
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <Text
                    style={[
                        Type.headlineItalic,
                        { color: palette.text, fontSize: 18 },
                    ]}
                >
                    Wishlist
                </Text>
                {/* Replaces the old + icon (OQ (a) resolved: single text button) */}
                <Pressable
                    onPress={() => setImportSheetVisible(true)}
                    hitSlop={12}
                    style={[styles.headerSide, { alignItems: 'flex-end' }]}
                    accessibilityLabel="add from link"
                >
                    <Text style={[Type.body, { color: palette.textMuted }]}>add from link</Text>
                </Pressable>
            </View>

            {/* [N7] Pending/needs_confirm capture cards at top of the list */}
            {pendingRows.length > 0 ? (
                <View style={styles.pendingSection}>
                    {pendingRows.map((item) => (
                        <PendingSaveCard
                            key={item.id}
                            status={item.extraction_status as 'pending' | 'needs_confirm'}
                            restaurantName={item.restaurant?.name}
                            restaurantCity={item.restaurant?.city}
                            restaurantCuisine={item.restaurant?.cuisine}
                            restaurantPhotoUrl={item.restaurant?.photo_url}
                            onConfirm={
                                item.extraction_status === 'needs_confirm'
                                    ? () => handleConfirm(item)
                                    : undefined
                            }
                        />
                    ))}
                </View>
            ) : null}

            {user ? <WishlistByCity userId={user.id} /> : null}

            <ImportLinkSheet
                visible={importSheetVisible}
                onDismiss={() => setImportSheetVisible(false)}
            />

            {/* [N7] Correction modal — "tap to confirm" → EditMatchPanel-like search */}
            {user ? (
                <CorrectModal
                    visible={correctItem !== null}
                    item={correctItem}
                    userId={user.id}
                    onDone={() => setCorrectItem(null)}
                    palette={palette}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingBottom: Spacing.md,
        paddingHorizontal: 22,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerSide: {
        width: 80,
    },
    pendingSection: {
        paddingHorizontal: 22,
        paddingBottom: Spacing.sm,
    },
});
