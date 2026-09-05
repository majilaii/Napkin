/** Inline list creation from a restaurant; keyboard padding keeps its CTA reachable. */
import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';
import { ListComposeFields, ListCreateButton } from './ListComposeFields';
import { useListComposer } from './useListComposer';

interface Props {
    visible: boolean;
    onClose: () => void;
    onCreated: (listId: string) => void;
    userId: string | null | undefined;
    restaurantId?: string;
    restaurantPayload?: RestaurantPayload;
}

export function CreateListSheet(props: Props) {
    // Each presentation starts a fresh draft; closing also invalidates async callbacks.
    return props.visible ? <ComposerSheet key={props.userId ?? 'signed-out'} {...props} /> : null;
}

function ComposerSheet({ onClose, onCreated, userId, restaurantId, restaurantPayload }: Props) {
    const palette = Colors[useColorScheme() ?? 'light'];
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();
    const keyboardHeight = useKeyboardHeight();
    const kbPad = Platform.OS === 'ios' ? keyboardHeight : 0;
    const composer = useListComposer({
        userId, onCreated, onCancel: onClose,
        initial: { initial_restaurant_id: restaurantId, initial_restaurant: restaurantPayload },
    });
    return <Modal visible transparent animationType="slide" onRequestClose={composer.cancel}>
        <Pressable accessibilityLabel="cancel new list" disabled={composer.busy} onPress={composer.cancel}
            style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
        <View style={[styles.sheet, Shadow.ambient, { backgroundColor: palette.background,
            paddingBottom: kbPad > 0 ? kbPad + Spacing.sm : insets.bottom + Spacing.lg,
            maxHeight: height - insets.top - Spacing.xl }]}>
            <View style={styles.header}>
                <Text style={[Type.sectionKicker, { color: palette.primary }]}>new list</Text>
                <Pressable accessibilityRole="button" disabled={composer.busy} onPress={composer.cancel} style={styles.cancel}>
                    <Text style={[Type.body, { color: palette.textMuted }]}>cancel</Text>
                </Pressable>
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <ListComposeFields {...composer} onChange={composer.change} palette={palette} />
            </ScrollView>
            <View style={styles.footer}>
                <ListCreateButton {...composer} onPress={composer.submit} palette={palette} />
            </View>
        </View>
    </Modal>;
}
const styles = StyleSheet.create({
    backdrop: { flex: 1 },
    sheet: { position: 'absolute', bottom: 0, left: 0, right: 0,
        borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl, paddingTop: Spacing.sm },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg },
    cancel: { minHeight: 44, justifyContent: 'center' },
    scroll: { flexGrow: 0, flexShrink: 1 },
    content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
    footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
});
