/**
 * ImportListPickerSheet — the `+ list` sheet opened from the import-review "saving
 * to" chips (TICKET-181). A lightweight, DEFERRED multi-select over the caller's
 * lists: nothing is created or mutated here. Selection rides back to the review
 * screen (existing list ids + new-list titles) and is committed onto the import
 * manifest at save time — new titles stay title-deduped by the drain
 * (resolveNewLists), matching the replay-safe "don't create eagerly" semantics.
 *
 * Grammar reused from AddToListSheet / ImportToListSheet: backdrop + absolute sheet,
 * grabber, kicker, serif italic list NAMES (a name is content), ✓ multi-select, and
 * an inline `+ new list…` row. Functional labels stay Manrope. No emoji in chrome.
 *
 * Presented as a plain sibling Modal — the review screen is a pushed card, not a
 * Modal, so no Fabric modal-stacking nest is needed here (unlike ProfileTopFourSheet
 * over an open pageSheet).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    FlatList,
    TextInput,
    StyleSheet,
    TouchableWithoutFeedback,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyLists, type MyList } from '@/hooks/lists/useMyLists';

type Palette = typeof Colors.light;

interface Props {
    visible: boolean;
    onClose: () => void;
    userId: string | null | undefined;
    /** Currently-chosen existing list ids. */
    selectedListIds: string[];
    /** Currently-chosen new-list titles (not yet created). */
    newListTitles: string[];
    /** Toggle an existing list on/off. */
    onToggleList: (listId: string) => void;
    /** Add a new-list title (already deduped by the caller). */
    onAddNewTitle: (title: string) => void;
    /** Remove a pending new-list title. */
    onRemoveNewTitle: (title: string) => void;
}

export function ImportListPickerSheet({
    visible,
    onClose,
    userId,
    selectedListIds,
    newListTitles,
    onToggleList,
    onAddNewTitle,
    onRemoveNewTitle,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();

    const { data: myLists = [], isLoading } = useMyLists(userId);
    const [draft, setDraft] = useState('');

    const selectedSet = useMemo(() => new Set(selectedListIds), [selectedListIds]);
    const newTitleSet = useMemo(
        () => new Set(newListTitles.map((t) => t.trim().toLowerCase())),
        [newListTitles],
    );

    const submitDraft = useCallback(() => {
        const title = draft.trim();
        if (!title) return;
        const lower = title.toLowerCase();
        // Dedupe: a typed title that matches an existing list selects THAT list; a
        // repeat new-title is a no-op — so the chips never double up on one name.
        const existing = myLists.find((l) => (l.title ?? '').trim().toLowerCase() === lower);
        if (existing) {
            if (!selectedSet.has(existing.id)) onToggleList(existing.id);
        } else if (!newTitleSet.has(lower)) {
            onAddNewTitle(title);
        }
        setDraft('');
    }, [draft, myLists, selectedSet, newTitleSet, onToggleList, onAddNewTitle]);

    const renderRow = useCallback(
        ({ item }: { item: MyList }) => {
            const on = selectedSet.has(item.id);
            return (
                <Pressable
                    onPress={() => onToggleList(item.id)}
                    style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={item.title}
                >
                    <View style={styles.rowBody}>
                        <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                            {item.emoji ? `${item.emoji} ` : ''}
                            {item.title}
                        </Text>
                        <Text style={[styles.rowMeta, { color: palette.textMuted }]} numberOfLines={1}>
                            {item.entry_count} {item.entry_count === 1 ? 'place' : 'places'}
                            {item.table_id && item.table_name ? ` · ${item.table_name}` : ''}
                        </Text>
                    </View>
                    <View
                        style={[
                            styles.checkbox,
                            on
                                ? { backgroundColor: palette.primary, borderColor: palette.primary }
                                : { borderColor: palette.outlineVariant },
                        ]}
                    >
                        {on ? <Ionicons name="checkmark" size={15} color="#fffdf8" /> : null}
                    </View>
                </Pressable>
            );
        },
        [selectedSet, onToggleList, palette],
    );

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
            </TouchableWithoutFeedback>

            <View
                style={[
                    styles.sheet,
                    { backgroundColor: palette.background, paddingBottom: insets.bottom + Spacing.sm },
                    Shadow.ambient,
                ]}
            >
                <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />

                <Text style={[styles.kicker, { color: palette.textMuted }]}>ADD TO A LIST</Text>

                {/* Inline + new list… — a typed title is deferred (never created here). */}
                <View style={[styles.newRow, { backgroundColor: palette.card }, Shadow.subtle]}>
                    <Ionicons name="add" size={18} color={palette.primary} />
                    <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        onSubmitEditing={submitDraft}
                        placeholder="new list…"
                        placeholderTextColor={palette.textMuted}
                        returnKeyType="done"
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={[styles.newInput, { color: palette.text }]}
                    />
                    {draft.trim() ? (
                        <Pressable onPress={submitDraft} hitSlop={8} accessibilityLabel="add new list">
                            <Text style={[styles.addLabel, { color: palette.primary }]}>add</Text>
                        </Pressable>
                    ) : null}
                </View>

                {/* Pending new titles — checked rows so they can be removed here too. */}
                {newListTitles.map((t) => (
                    <Pressable
                        key={`new:${t}`}
                        onPress={() => onRemoveNewTitle(t)}
                        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: true }}
                        accessibilityLabel={t}
                    >
                        <View style={styles.rowBody}>
                            <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                                {t}
                            </Text>
                            <Text style={[styles.rowMeta, { color: palette.textMuted }]}>new list</Text>
                        </View>
                        <View style={[styles.checkbox, { backgroundColor: palette.primary, borderColor: palette.primary }]}>
                            <Ionicons name="checkmark" size={15} color="#fffdf8" />
                        </View>
                    </Pressable>
                ))}

                {isLoading && myLists.length === 0 ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.xl }} />
                ) : (
                    <FlatList
                        data={myLists}
                        keyExtractor={(item) => item.id}
                        renderItem={renderRow}
                        style={styles.list}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={
                            <Text style={[styles.empty, { color: palette.textMuted }]}>
                                no lists yet — type a name above.
                            </Text>
                        }
                    />
                )}

                <Pressable
                    onPress={onClose}
                    style={({ pressed }) => [
                        styles.doneButton,
                        { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                >
                    <Text style={styles.doneLabel}>done</Text>
                </Pressable>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1 },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xxl,
        borderTopRightRadius: Radius.xxl,
        paddingTop: Spacing.sm,
        maxHeight: '82%',
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: Radius.full,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.5,
        paddingHorizontal: 22,
        marginBottom: Spacing.sm,
    },
    newRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 22,
        paddingHorizontal: 12,
        paddingVertical: 11,
        borderRadius: Radius.md,
        marginBottom: Spacing.sm,
    },
    newInput: {
        flex: 1,
        fontFamily: 'Manrope_500Medium',
        fontSize: 14,
        padding: 0,
    },
    addLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.2,
    },
    list: {
        flexGrow: 0,
        paddingHorizontal: 22,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 11,
        paddingHorizontal: 22,
    },
    rowBody: { flex: 1, gap: 2, minWidth: 0 },
    rowName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 20,
    },
    rowMeta: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: Radius.full,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    empty: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 14,
        textAlign: 'center',
        paddingVertical: Spacing.xl,
        paddingHorizontal: 22,
    },
    doneButton: {
        marginHorizontal: 22,
        marginTop: Spacing.sm,
        paddingVertical: 15,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    doneLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 15,
        letterSpacing: 0.3,
        color: '#fffdf8',
    },
});

export default ImportListPickerSheet;
