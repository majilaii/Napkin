/**
 * GuestPlacesScreen: signed-out Places tab (TICKET-247, Guideline 5.1.1(v)).
 *
 * Reads Napkin's own catalogue through `public-browse` only. No Google search,
 * no map, no pins: those are account features and route to `/auth`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import { ErrorState } from '@/components/ErrorState';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    GUEST_SEARCH_MIN_CHARS,
    useGuestRecent,
    useGuestSearch,
    type GuestRestaurantRow,
} from '@/hooks/guest/usePublicBrowse';
import { GuestPlaceRow } from './GuestPlaceRow';
import { GuestSignInBand } from './GuestSignInBand';

const SEARCH_DEBOUNCE_MS = 250;

export function GuestPlacesScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [focused, setFocused] = useState(false);

    // Same 250ms settle as the signed-in Places search: one request per pause,
    // not per keystroke (the guest endpoint is rate-limited per client).
    useEffect(() => {
        const handle = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [query]);

    const trimmed = query.trim();
    const searching = trimmed.length >= GUEST_SEARCH_MIN_CHARS;
    const recent = useGuestRecent();
    const search = useGuestSearch(debouncedQuery);
    // Between a keystroke and the debounce settling, the result list still
    // belongs to the previous query: show it as loading, not as "no match".
    const settling = searching && debouncedQuery.trim() !== trimmed;

    const rows: GuestRestaurantRow[] = searching
        ? (search.data ?? [])
        : trimmed.length === 0
            ? (recent.data ?? [])
            : [];

    const openRow = useCallback((row: GuestRestaurantRow) => {
        router.push({ pathname: '/restaurant/[id]', params: { id: row.id } });
    }, [router]);

    const renderItem = useCallback(({ item }: { item: GuestRestaurantRow }) => (
        <GuestPlaceRow row={item} onPress={() => openRow(item)} palette={palette} />
    ), [openRow, palette]);

    let body: React.ReactNode = null;
    if (trimmed.length === 0) {
        if (recent.data && recent.data.length === 0) {
            body = <Text style={[Type.bodySmall, styles.line, { color: palette.textMuted }]}>nothing reviewed yet.</Text>;
        } else if (recent.isError && !recent.data) {
            body = <ErrorState onRetry={() => void recent.refetch()} />;
        } else if (recent.isLoading) {
            body = <ActivityIndicator color={palette.primary} style={styles.spinner} />;
        }
    } else if (!searching) {
        body = <Text style={[Type.bodySmall, styles.line, { color: palette.textMuted }]}>type one more letter</Text>;
    } else if (search.isError && !search.data) {
        body = <ErrorState onRetry={() => void search.refetch()} />;
    } else if ((search.isLoading || settling) && !search.data) {
        body = <ActivityIndicator color={palette.primary} style={styles.spinner} />;
    } else if (search.data && search.data.length === 0 && !settling) {
        body = <Text style={[Type.bodySmall, styles.line, { color: palette.textMuted }]}>nothing on napkin by that name yet.</Text>;
    }

    const showKicker = trimmed.length === 0 && rows.length > 0;

    return (
        <View style={[styles.root, { backgroundColor: palette.background }]}>
            <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                <Text style={[Type.screenTitle, { color: palette.text }]}>Places</Text>
                <Pressable
                    onPress={() => router.push('/auth')}
                    accessibilityRole="button"
                    accessibilityLabel="sign in"
                    style={({ pressed }) => [
                        styles.signIn,
                        { backgroundColor: palette.surfaceNote },
                        pressed && styles.pressed,
                    ]}
                >
                    <Text style={[Type.label, { color: palette.primary }]}>sign in</Text>
                </Pressable>
            </View>
            <View
                style={[
                    styles.underline,
                    {
                        borderBottomColor: focused ? palette.primary : 'rgba(138, 114, 108, 0.25)',
                        borderBottomWidth: focused ? 2 : 1,
                    },
                ]}
            >
                <Ionicons name="search-outline" size={IconSize.lg} color={palette.textMuted} />
                <TextInput
                    value={query}
                    onChangeText={setQuery}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder="search a place"
                    placeholderTextColor={palette.textMuted}
                    returnKeyType="search"
                    autoCorrect={false}
                    autoCapitalize="none"
                    accessibilityLabel="search a place"
                    style={[styles.input, Type.body, { color: palette.text }]}
                />
            </View>
            <FlatList
                data={rows}
                keyExtractor={(row) => row.id}
                renderItem={renderItem}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={styles.list}
                ListHeaderComponent={showKicker ? (
                    <Text style={[Type.labelSmall, styles.kicker, { color: palette.textMuted }]}>
                        RECENTLY REVIEWED
                    </Text>
                ) : null}
                ListEmptyComponent={body ? <View>{body}</View> : null}
                ListFooterComponent={trimmed.length === 0 ? <GuestSignInBand /> : null}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingBottom: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    signIn: {
        minHeight: 44,
        paddingHorizontal: Spacing.md,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pressed: { opacity: 0.8 },
    underline: {
        marginHorizontal: Spacing.restaurant.pageGutter,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingBottom: Spacing.xs,
    },
    input: { flex: 1, paddingVertical: Spacing.sm },
    list: { paddingTop: Spacing.md, paddingBottom: 120 },
    kicker: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingBottom: Spacing.sm,
    },
    line: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingVertical: Spacing.lg,
    },
    spinner: { paddingVertical: Spacing.xl },
});
