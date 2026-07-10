/**
 * CreateListSheet — compact bottom sheet for inline list creation.
 * Opened from AddToListSheet's "+ New list" row.
 *
 * Fields: title (required), ranked toggle (default off), privacy toggle (default public).
 * If restaurantId/restaurantPayload provided, the restaurant is added as the initial entry.
 *
 * Keyboard geometry follows the GatherSheet idiom: the sheet stays anchored to
 * the screen bottom and pads itself above the iOS keyboard via useKeyboardHeight,
 * with the action row pinned below the ScrollView so it can never scroll out of
 * reach. (KeyboardAvoidingView behavior="position" is banned here: this sheet
 * opens on top of AddToListSheet with an autofocused field, and a focus steal
 * mid-keyboard-transition — validation Alert, modal hand-off — leaves a stale
 * offset that strands the sheet mid-screen.) Android keeps system adjustResize.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    TextInput,
    Switch,
    StyleSheet,
    TouchableWithoutFeedback,
    Alert,
    ScrollView,
    Platform,
    useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useCreateList } from '@/hooks/lists/useCreateList';
import { ListEmojiPicker } from './ListEmojiPicker';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';

type Palette = typeof Colors.light;

interface Props {
    visible: boolean;
    onClose: () => void;
    onCreated: (listId: string) => void;
    userId: string | null | undefined;
    restaurantId?: string;
    restaurantPayload?: RestaurantPayload;
}

export function CreateListSheet({
    visible,
    onClose,
    onCreated,
    userId,
    restaurantId,
    restaurantPayload,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    // Android keeps the system adjustResize behavior; only iOS needs manual padding.
    const keyboardHeight = useKeyboardHeight();
    const kbPad = Platform.OS === 'ios' ? keyboardHeight : 0;

    const [title, setTitle] = useState('');
    const [ranked, setRanked] = useState(false);
    const [isPublic, setIsPublic] = useState(true);
    const [description, setDescription] = useState('');
    const [showDescription, setShowDescription] = useState(false);
    const [emoji, setEmoji] = useState<string | null>(null);

    const createList = useCreateList(userId);

    const handleSubmit = () => {
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            Alert.alert('Title required', 'Please give your list a name.');
            return;
        }
        if (trimmedTitle.length > 60) {
            Alert.alert('Title too long', 'List name must be 60 characters or fewer.');
            return;
        }

        createList.mutate(
            {
                title: trimmedTitle,
                description: description.trim() || undefined,
                ranked,
                privacy: isPublic ? 'public' : 'private',
                emoji,
                initial_restaurant_id: restaurantId,
                initial_restaurant: restaurantPayload,
            },
            {
                onSuccess: (list) => {
                    setTitle('');
                    setRanked(false);
                    setIsPublic(true);
                    setDescription('');
                    setShowDescription(false);
                    setEmoji(null);
                    onCreated(list.id);
                },
                onError: () => Alert.alert("Couldn't create list", 'Try again'),
            },
        );
    };

    const handleClose = () => {
        setTitle('');
        setRanked(false);
        setIsPublic(true);
        setDescription('');
        setShowDescription(false);
        setEmoji(null);
        onClose();
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={handleClose}
        >
            <TouchableWithoutFeedback onPress={handleClose}>
                <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
            </TouchableWithoutFeedback>

            <View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.card,
                        paddingBottom: kbPad > 0 ? kbPad + Spacing.sm : insets.bottom + Spacing.lg,
                        maxHeight: windowHeight - insets.top - Spacing.xl,
                    },
                    Shadow.ambient,
                ]}
            >
                {/* Handle */}
                <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />

                <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled">
                    <Text
                        style={[
                            Type.headlineMedium,
                            {
                                color: palette.text,
                                paddingHorizontal: Spacing.lg,
                                marginBottom: Spacing.lg,
                            },
                        ]}
                    >
                        New list
                    </Text>

                    {/* Title */}
                    <View style={styles.field}>
                        <Text style={[Type.label, { color: palette.textMuted, marginBottom: Spacing.xs }]}>
                            Name
                        </Text>
                        <TextInput
                            style={[
                                styles.input,
                                Type.titleMedium,
                                {
                                    color: palette.text,
                                    borderColor: palette.outlineVariant,
                                    backgroundColor: palette.surfaceContainerLow,
                                },
                            ]}
                            value={title}
                            onChangeText={(t) => setTitle(t.slice(0, 60))}
                            placeholder="e.g. Best brunch SF"
                            placeholderTextColor={palette.textMuted}
                            maxLength={60}
                            autoFocus
                            returnKeyType="next"
                        />
                        <Text style={[Type.caption, { color: palette.textMuted, textAlign: 'right', marginTop: 2 }]}>
                            {title.length}/60
                        </Text>
                    </View>

                    {/* Description (optional, collapsed by default) */}
                    {showDescription ? (
                        <View style={styles.field}>
                            <Text style={[Type.label, { color: palette.textMuted, marginBottom: Spacing.xs }]}>
                                Description (optional)
                            </Text>
                            <TextInput
                                style={[
                                    styles.input,
                                    Type.body,
                                    {
                                        color: palette.text,
                                        borderColor: palette.outlineVariant,
                                        backgroundColor: palette.surfaceContainerLow,
                                    },
                                ]}
                                value={description}
                                onChangeText={(t) => setDescription(t.slice(0, 140))}
                                placeholder="A short description…"
                                placeholderTextColor={palette.textMuted}
                                maxLength={140}
                                multiline
                                numberOfLines={2}
                            />
                            <Text style={[Type.caption, { color: palette.textMuted, textAlign: 'right', marginTop: 2 }]}>
                                {description.length}/140
                            </Text>
                        </View>
                    ) : (
                        <Pressable
                            onPress={() => setShowDescription(true)}
                            style={styles.field}
                        >
                            <Text style={[Type.bodySmall, { color: palette.primary }]}>
                                + Add description
                            </Text>
                        </Pressable>
                    )}

                    {/* Icon (emoji) — differentiates lists on the map */}
                    <View style={styles.emojiField}>
                        <ListEmojiPicker value={emoji} onChange={setEmoji} palette={palette} />
                    </View>

                    {/* Ranked toggle */}
                    <View style={[styles.toggleRow, { borderTopColor: palette.surfaceContainerLow }]}>
                        <View>
                            <Text style={[Type.titleSmall, { color: palette.text }]}>Ranked</Text>
                            <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                                Number entries in order
                            </Text>
                        </View>
                        <Switch
                            value={ranked}
                            onValueChange={setRanked}
                            trackColor={{ false: palette.outlineVariant, true: palette.primary }}
                            thumbColor="#fff"
                        />
                    </View>

                    {/* Privacy toggle */}
                    <View style={[styles.toggleRow, { borderTopColor: palette.surfaceContainerLow }]}>
                        <View>
                            <Text style={[Type.titleSmall, { color: palette.text }]}>Public</Text>
                            <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                                Visible to anyone with the link
                            </Text>
                        </View>
                        <Switch
                            value={isPublic}
                            onValueChange={setIsPublic}
                            trackColor={{ false: palette.outlineVariant, true: palette.primary }}
                            thumbColor="#fff"
                        />
                    </View>

                </ScrollView>

                {/* Actions — pinned below the scroll area so they never scroll out of reach */}
                <View style={styles.actions}>
                    <Pressable
                        onPress={handleClose}
                        style={({ pressed }) => [
                            styles.cancelButton,
                            {
                                backgroundColor: palette.surfaceContainerLow,
                                opacity: pressed ? 0.8 : 1,
                            },
                        ]}
                    >
                        <Text style={[Type.titleSmall, { color: palette.textSecondary }]}>
                            Cancel
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={handleSubmit}
                        disabled={createList.isPending}
                        style={({ pressed }) => [
                            styles.createButton,
                            {
                                backgroundColor: palette.primary,
                                opacity: pressed || createList.isPending ? 0.7 : 1,
                            },
                        ]}
                    >
                        <Text style={[Type.titleSmall, { color: palette.textInverse }]}>
                            {createList.isPending ? 'Creating…' : 'Create list'}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
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
    },
    // Shrinks (and scrolls) before the pinned actions do when the sheet hits maxHeight.
    scrollArea: {
        flexGrow: 0,
        flexShrink: 1,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: Radius.full,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    field: {
        paddingHorizontal: Spacing.lg,
        marginBottom: Spacing.md,
    },
    emojiField: {
        paddingLeft: Spacing.lg,
    },
    input: {
        borderWidth: 1,
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        borderTopWidth: 1,
    },
    actions: {
        flexDirection: 'row',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        gap: Spacing.md,
    },
    cancelButton: {
        flex: 1,
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        alignItems: 'center',
    },
    createButton: {
        flex: 2,
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        alignItems: 'center',
    },
});
