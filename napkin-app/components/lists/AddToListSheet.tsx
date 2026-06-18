/**
 * AddToListSheet — bottom sheet that appears on restaurant pages.
 *
 * Shows:
 *   - "+ New list" row at top (opens CreateListSheet)
 *   - User's existing lists, MRU order, each with a checkmark if the restaurant
 *     is already in that list (driven by useListsContainingRestaurant)
 *
 * Tapping an unchecked list adds the restaurant; tapping a checked list removes it.
 * Both are optimistic (mutations from hooks).
 *
 * Same Modal + TouchableWithoutFeedback pattern as LogVisitSheet.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    FlatList,
    StyleSheet,
    TouchableWithoutFeedback,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { useListsContainingRestaurant } from '@/hooks/lists/useListsContainingRestaurant';
import { useAddToList } from '@/hooks/lists/useAddToList';
import { useRemoveFromList } from '@/hooks/lists/useRemoveFromList';
import { CreateListSheet } from './CreateListSheet';
import type { MyList } from '@/hooks/lists/useMyLists';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';

type Palette = typeof Colors.light;

interface Props {
    visible: boolean;
    onClose: () => void;
    userId: string | null | undefined;
    /** UUID of a persisted restaurant. Provide this OR restaurantPayload. */
    restaurantId?: string;
    /** Places ghost payload. Server will upsert it. */
    restaurantPayload?: RestaurantPayload;
    restaurantName?: string;
    /** Show the personal Wishlist as the first, pinned destination row. */
    showWishlist?: boolean;
    isWishlisted?: boolean;
    onToggleWishlist?: () => void;
}

export function AddToListSheet({
    visible,
    onClose,
    userId,
    restaurantId,
    restaurantPayload,
    restaurantName,
    showWishlist = false,
    isWishlisted = false,
    onToggleWishlist,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const insets = useSafeAreaInsets();

    const [showCreate, setShowCreate] = useState(false);

    const { data: myLists = [], isLoading: listsLoading } = useMyLists(userId);
    const { data: containingIds = [] } = useListsContainingRestaurant(userId, restaurantId);

    const addToList = useAddToList(userId);
    const removeFromList = useRemoveFromList(userId);

    const handleToggle = (list: MyList) => {
        const isIn = containingIds.includes(list.id);

        if (isIn) {
            if (!restaurantId) return; // can't remove without a persisted ID
            removeFromList.mutate(
                { list_id: list.id, restaurant_id: restaurantId },
                {
                    onError: () =>
                        Alert.alert("Couldn't update list", 'Try again'),
                },
            );
        } else {
            const input = restaurantId
                ? { list_id: list.id, restaurant_id: restaurantId }
                : { list_id: list.id, restaurant: restaurantPayload };

            addToList.mutate(input as any, {
                onError: () => Alert.alert("Couldn't update list", 'Try again'),
            });
        }
    };

    const handleCreateDone = () => {
        setShowCreate(false);
        // Don't close parent sheet — user may want to add to other lists
    };

    return (
        <>
            <Modal
                visible={visible && !showCreate}
                transparent
                animationType="slide"
                onRequestClose={onClose}
            >
                <TouchableWithoutFeedback onPress={onClose}>
                    <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
                </TouchableWithoutFeedback>

                <View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: palette.card,
                            paddingBottom: insets.bottom + Spacing.lg,
                        },
                        Shadow.ambient,
                    ]}
                >
                    {/* Handle */}
                    <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />

                    <Text
                        style={[
                            Type.headlineMedium,
                            {
                                color: palette.text,
                                paddingHorizontal: Spacing.lg,
                                marginBottom: Spacing.md,
                            },
                        ]}
                    >
                        {showWishlist ? 'Save to…' : 'Add to list'}
                    </Text>

                    {/* Wishlist — the personal, private save. Pinned above curated lists. */}
                    {showWishlist ? (
                        <>
                            <Pressable
                                onPress={onToggleWishlist}
                                accessibilityRole="button"
                                accessibilityLabel={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                                style={({ pressed }) => [
                                    styles.row,
                                    {
                                        backgroundColor: pressed
                                            ? palette.surfaceContainerLow
                                            : 'transparent',
                                    },
                                ]}
                            >
                                <View
                                    style={[
                                        styles.iconCircle,
                                        {
                                            backgroundColor: isWishlisted
                                                ? palette.primaryMuted
                                                : palette.surfaceContainerLow,
                                        },
                                    ]}
                                >
                                    <Ionicons
                                        name={isWishlisted ? 'bookmark' : 'bookmark-outline'}
                                        size={18}
                                        color={isWishlisted ? palette.primary : palette.textMuted}
                                    />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text
                                        style={[Type.titleSmall, { color: palette.text }]}
                                        numberOfLines={1}
                                    >
                                        Wishlist
                                    </Text>
                                    <Text
                                        style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}
                                    >
                                        your private saves
                                    </Text>
                                </View>
                                {isWishlisted ? (
                                    <Ionicons name="checkmark" size={18} color={palette.primary} />
                                ) : null}
                            </Pressable>
                            <View style={[styles.divider, { backgroundColor: palette.surfaceContainerLow }]} />
                        </>
                    ) : null}

                    {/* + New list */}
                    <Pressable
                        onPress={() => setShowCreate(true)}
                        style={({ pressed }) => [
                            styles.row,
                            {
                                backgroundColor: pressed
                                    ? palette.surfaceContainerLow
                                    : 'transparent',
                            },
                        ]}
                    >
                        <View
                            style={[
                                styles.iconCircle,
                                { backgroundColor: palette.primaryMuted },
                            ]}
                        >
                            <Ionicons name="add" size={20} color={palette.primary} />
                        </View>
                        <Text style={[Type.titleSmall, { color: palette.primary, flex: 1 }]}>
                            New list
                        </Text>
                    </Pressable>

                    {/* Divider */}
                    {myLists.length > 0 && (
                        <View style={[styles.divider, { backgroundColor: palette.surfaceContainerLow }]} />
                    )}

                    {listsLoading ? (
                        <ActivityIndicator
                            size="small"
                            color={palette.primary}
                            style={{ marginTop: Spacing.md }}
                        />
                    ) : (
                        <FlatList
                            data={myLists}
                            keyExtractor={(item) => item.id}
                            style={styles.list}
                            renderItem={({ item }) => {
                                const isIn = containingIds.includes(item.id);
                                return (
                                    <Pressable
                                        onPress={() => handleToggle(item)}
                                        style={({ pressed }) => [
                                            styles.row,
                                            {
                                                backgroundColor: pressed
                                                    ? palette.surfaceContainerLow
                                                    : 'transparent',
                                            },
                                        ]}
                                    >
                                        <View
                                            style={[
                                                styles.iconCircle,
                                                {
                                                    backgroundColor: isIn
                                                        ? palette.primaryMuted
                                                        : palette.surfaceContainerLow,
                                                },
                                            ]}
                                        >
                                            <Ionicons
                                                name={isIn ? 'checkmark' : 'list-outline'}
                                                size={18}
                                                color={isIn ? palette.primary : palette.textMuted}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text
                                                style={[Type.titleSmall, { color: palette.text }]}
                                                numberOfLines={1}
                                            >
                                                {item.title}
                                            </Text>
                                            <Text
                                                style={[
                                                    Type.bodySmall,
                                                    { color: palette.textMuted, marginTop: 2 },
                                                ]}
                                            >
                                                {item.entry_count}{' '}
                                                {item.entry_count === 1 ? 'place' : 'places'}
                                                {item.ranked ? ' · Ranked' : ''}
                                            </Text>
                                        </View>
                                        {item.privacy === 'private' && (
                                            <Ionicons
                                                name="lock-closed"
                                                size={12}
                                                color={palette.textMuted}
                                            />
                                        )}
                                    </Pressable>
                                );
                            }}
                            ListEmptyComponent={
                                <Text
                                    style={[
                                        Type.bodySmall,
                                        {
                                            color: palette.textMuted,
                                            textAlign: 'center',
                                            paddingVertical: Spacing.lg,
                                            paddingHorizontal: Spacing.lg,
                                        },
                                    ]}
                                >
                                    No lists yet. Tap &ldquo;New list&rdquo; to create one.
                                </Text>
                            }
                        />
                    )}
                </View>
            </Modal>

            {/* Inline create — renders on top of the add sheet */}
            <CreateListSheet
                visible={showCreate}
                onClose={() => setShowCreate(false)}
                onCreated={handleCreateDone}
                userId={userId}
                restaurantId={restaurantId}
                restaurantPayload={restaurantPayload}
            />
        </>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xxl,
        borderTopRightRadius: Radius.xxl,
        paddingTop: Spacing.sm,
        maxHeight: '70%',
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: Radius.full,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    list: {
        flexGrow: 0,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        gap: Spacing.md,
    },
    iconCircle: {
        width: 40,
        height: 40,
        borderRadius: Radius.full,
        justifyContent: 'center',
        alignItems: 'center',
    },
    divider: {
        height: 1,
        marginHorizontal: Spacing.lg,
        marginVertical: Spacing.xs,
    },
});
