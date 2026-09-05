import React, { useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { FieldUnderline } from '@/components/ui/FieldUnderline';
import { ListEmojiPicker } from './ListEmojiPicker';
import type { ListDraft } from './useListComposer';

type Palette = typeof Colors.light;

export function ListComposeFields({ draft, onChange, busy, palette, tableName }: {
    draft: ListDraft;
    onChange: (patch: Partial<ListDraft>) => void;
    busy: boolean;
    palette: Palette;
    /** Present for Table lists, whose audience cannot be changed here. */
    tableName?: string;
}) {
    const [showIcons, setShowIcons] = useState(false);
    return (
        <View style={styles.fields}>
            <View style={styles.nameRow}>
                <Pressable
                    accessibilityRole="button" accessibilityLabel="choose list icon"
                    accessibilityState={{ expanded: showIcons, disabled: busy }} disabled={busy}
                    onPress={() => setShowIcons((current) => !current)}
                    style={[styles.iconPlate, { backgroundColor: palette.surfaceJournalHi }]}
                >
                    {draft.emoji ? <Text style={styles.emoji}>{draft.emoji}</Text>
                        : <Ionicons name="albums-outline" size={22} color={palette.textSecondary} />}
                </Pressable>
                <FieldUnderline
                    value={draft.title} onChangeText={(title) => onChange({ title })}
                    placeholder="Sunday brunch" accessibilityLabel="list name" maxLength={60}
                    editable={!busy} autoFocus returnKeyType="done" onSubmitEditing={Keyboard.dismiss}
                    containerStyle={styles.nameField}
                    inputStyle={[Type.listNameInput, styles.underline]}
                />
            </View>
            {draft.title.length >= 50 ? <Text style={[Type.metadata, styles.counter, { color: palette.textMuted }]}>{draft.title.length}/60</Text> : null}
            {showIcons && !busy ? <View style={styles.iconPicker}>
                <ListEmojiPicker value={draft.emoji} palette={palette} variant="compact"
                    onChange={(emoji) => onChange({ emoji })} onPick={() => setShowIcons(false)} />
            </View> : null}
            <FieldUnderline
                value={draft.description} onChangeText={(description) => onChange({ description })}
                placeholder="add a note" accessibilityLabel="list description, optional"
                editable={!busy} multiline maxLength={140}
                containerStyle={styles.noteField} inputStyle={[Type.body, styles.underline]}
            />
            {draft.description.length >= 120 ? <Text style={[Type.metadata, styles.counter, { color: palette.textMuted }]}>{draft.description.length}/140</Text> : null}
            <View style={styles.options}>
                <Pressable accessibilityRole="checkbox" accessibilityLabel="ranked list"
                    accessibilityHint="Number places in your chosen order"
                    accessibilityState={{ checked: draft.ranked, disabled: busy }} disabled={busy}
                    onPress={() => onChange({ ranked: !draft.ranked })}
                    style={[styles.option, { backgroundColor: draft.ranked ? palette.primaryMuted : palette.surfaceJournalHi }]}
                >
                    <Ionicons name="podium-outline" size={18} color={draft.ranked ? palette.primary : palette.textMuted} />
                    <Text style={[Type.metadata, { color: draft.ranked ? palette.primary : palette.textMuted }]}>ranked</Text>
                </Pressable>
                {tableName !== undefined ? <View style={[styles.option, styles.tableOption, { backgroundColor: palette.surfaceJournalHi }]}>
                    <Ionicons name="people-outline" size={18} color={palette.textMuted} />
                    <Text style={[Type.metadata, styles.tableName, { color: palette.textMuted }]} numberOfLines={1}>{tableName}</Text>
                </View> : <Pressable accessibilityRole="button" accessibilityLabel={`list visibility: ${draft.privacy}`}
                    accessibilityHint={`Change to ${draft.privacy === 'public' ? 'private' : 'public'}`}
                    accessibilityState={{ disabled: busy }} disabled={busy}
                    onPress={() => onChange({ privacy: draft.privacy === 'public' ? 'private' : 'public' })}
                    style={[styles.option, { backgroundColor: palette.surfaceJournalHi }]}
                >
                    <Ionicons name={draft.privacy === 'public' ? 'globe-outline' : 'lock-closed-outline'} size={18} color={palette.textMuted} />
                    <Text style={[Type.metadata, { color: palette.textMuted }]}>{draft.privacy}</Text>
                </Pressable>}
            </View>
            <Text style={[Type.metadata, styles.hint, { color: palette.textMuted }]}>
                {draft.ranked ? 'numbered in order' : 'newest first'}
                {tableName !== undefined ? ' · shared with table members' : ''}
            </Text>
        </View>
    );
}

export function ListCreateButton({ onPress, canSubmit, busy, error, palette }: {
    onPress: () => void; canSubmit: boolean; busy: boolean; error: string | null; palette: Palette;
}) {
    return <>
        {error ? <Text accessibilityLiveRegion="polite" style={[Type.body, styles.error, { color: palette.error }]}>{error}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="create list"
            accessibilityState={{ disabled: !canSubmit, busy }} disabled={!canSubmit} onPress={onPress}
            style={({ pressed }) => [styles.create, { backgroundColor: palette.primary, opacity: !canSubmit ? 0.34 : pressed ? 0.8 : 1 }]}
        >
            {busy ? <ActivityIndicator color={palette.textInverse} /> : <Text style={[Type.body, styles.createLabel, { color: palette.textInverse }]}>create list</Text>}
        </Pressable>
    </>;
}

const styles = StyleSheet.create({
    fields: { paddingTop: Spacing.md },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    nameField: { flex: 1 },
    underline: { minHeight: 48, borderBottomWidth: 2 },
    iconPlate: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
    emoji: { fontSize: 22, lineHeight: 28 },
    iconPicker: { marginTop: Spacing.md },
    noteField: { marginTop: Spacing.lg },
    counter: { textAlign: 'right', marginTop: Spacing.xs },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.lg },
    option: { minHeight: 44, paddingHorizontal: Spacing.md, borderRadius: Radius.full, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    tableOption: { maxWidth: '100%' },
    tableName: { flexShrink: 1 },
    hint: { marginTop: Spacing.sm },
    error: { marginBottom: Spacing.sm },
    create: { minHeight: 52, padding: Spacing.md, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
    createLabel: { fontFamily: 'Manrope_600SemiBold' },
});
