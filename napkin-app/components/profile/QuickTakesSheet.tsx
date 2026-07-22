import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AccessibilityInfo,
    Alert,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, {
    ScaleDecorator,
    type RenderItemParams,
} from 'react-native-draggable-flatlist';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSetProfileQuickTakes } from '@/hooks/users/useSetProfileQuickTakes';
import { tintFor } from '@/lib/engraving';
import {
    MAX_PROFILE_QUICK_TAKES,
    MAX_PROFILE_QUICK_TAKE_NOTE,
    QUICK_TAKE_PROMPTS,
    quickTakePromptLabel,
    toProfileQuickTakeInputs,
    trimQuickTakeNote,
    type ProfileQuickTake,
    type QuickTakePromptKey,
} from '@/lib/profileQuickTakes';
import {
    RestaurantPickerScreen,
    type RestaurantPickerPick,
} from '@/components/search/RestaurantPickerScreen';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';
import { SheetHeader } from '@/components/ui/SheetHeader';

type Props = {
    visible: boolean;
    onClose: () => void;
    userId: string | null | undefined;
    profileIdentifier: string;
    currentTakes: ProfileQuickTake[];
};

type Palette = typeof Colors.light;

function sameTakes(a: ProfileQuickTake[], b: ProfileQuickTake[]): boolean {
    return JSON.stringify(toProfileQuickTakeInputs(a)) === JSON.stringify(toProfileQuickTakeInputs(b));
}

function DraftArtwork({
    take,
    photoUrl,
    palette,
    isDark,
    onPhotoError,
}: {
    take: ProfileQuickTake;
    photoUrl: string | null;
    palette: Palette;
    isDark: boolean;
    onPhotoError: () => void;
}) {
    return (
        <View
            style={[
                styles.thumb,
                {
                    backgroundColor: tintFor(take.restaurant_id, palette),
                    borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
                },
            ]}
        >
            {photoUrl ? (
                <>
                    <Image
                        source={{ uri: photoUrl }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        onError={onPhotoError}
                    />
                    <View
                        style={[
                            StyleSheet.absoluteFill,
                            { backgroundColor: palette.placesOverlayTint, opacity: palette.placesOverlayOpacity },
                        ]}
                    />
                </>
            ) : (
                <Text style={[styles.thumbLetter, { color: palette.primary }]}>
                    {(take.name.trim()[0] ?? '·').toUpperCase()}
                </Text>
            )}
        </View>
    );
}

function DraftRow({
    item,
    drag,
    isActive,
    palette,
    isDark,
    onEdit,
    onRemove,
    index,
    total,
    onMove,
    photoUrl,
    onPhotoError,
}: RenderItemParams<ProfileQuickTake> & {
    palette: Palette;
    isDark: boolean;
    onEdit: () => void;
    onRemove: () => void;
    index: number;
    total: number;
    onMove: (delta: -1 | 1) => void;
    photoUrl: string | null;
    onPhotoError: () => void;
}) {
    return (
        <ScaleDecorator activeScale={1.02}>
            <View
                style={[
                    styles.draftRow,
                    { backgroundColor: palette.card },
                    Shadow.subtle,
                    isActive ? { opacity: 0.92 } : null,
                ]}
            >
                <Pressable
                    onLongPress={drag}
                    delayLongPress={120}
                    style={styles.dragHandle}
                    accessibilityRole="adjustable"
                    accessibilityLabel={`Position for ${quickTakePromptLabel(item.prompt_key)}: ${item.name}`}
                    accessibilityHint="Swipe up or down to change position, or hold and drag"
                    accessibilityValue={{ min: 1, max: total, now: index + 1, text: `${index + 1} of ${total}` }}
                    accessibilityActions={[
                        ...(index > 0 ? [{ name: 'decrement' as const, label: 'Move up' }] : []),
                        ...(index < total - 1 ? [{ name: 'increment' as const, label: 'Move down' }] : []),
                    ]}
                    onAccessibilityAction={(event) => {
                        if (event.nativeEvent.actionName === 'decrement' && index > 0) onMove(-1);
                        if (event.nativeEvent.actionName === 'increment' && index < total - 1) onMove(1);
                    }}
                >
                    <Ionicons name="reorder-three-outline" size={23} color={palette.textMuted} />
                </Pressable>
                <Pressable
                    onPress={onEdit}
                    disabled={isActive}
                    style={styles.editArea}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${quickTakePromptLabel(item.prompt_key)}: ${item.name}`}
                >
                    <View style={styles.draftCopy}>
                        <Text style={[Type.sectionKicker, { color: palette.primary }]} numberOfLines={1}>
                            {quickTakePromptLabel(item.prompt_key)}
                        </Text>
                        <Text style={[Type.editorialBody, styles.draftName, { color: palette.text }]} numberOfLines={2}>
                            {item.name}
                        </Text>
                    </View>
                    <DraftArtwork
                        take={item}
                        photoUrl={photoUrl}
                        palette={palette}
                        isDark={isDark}
                        onPhotoError={onPhotoError}
                    />
                </Pressable>
                <Pressable
                    onPress={onRemove}
                    style={styles.removeButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.name}`}
                >
                    <Ionicons name="close" size={19} color={palette.textMuted} />
                </Pressable>
            </View>
        </ScaleDecorator>
    );
}

function TakeEditor({
    draft,
    unavailablePrompts,
    isExisting,
    palette,
    onChange,
    onBack,
    onDone,
    onChooseRestaurant,
    onDelete,
}: {
    draft: ProfileQuickTake;
    unavailablePrompts: Set<QuickTakePromptKey>;
    isExisting: boolean;
    palette: Palette;
    onChange: (take: ProfileQuickTake) => void;
    onBack: () => void;
    onDone: () => void;
    onChooseRestaurant: () => void;
    onDelete: () => void;
}) {
    const insets = useSafeAreaInsets();
    const noteLength = Array.from(draft.note ?? '').length;
    const canDone = !!draft.restaurant_id && !!draft.name;

    return (
        <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <SheetHeader
                title={isExisting ? 'Edit take' : 'Add a take'}
                leftLabel="Back"
                rightLabel="Done"
                onLeftPress={onBack}
                onRightPress={onDone}
                rightDisabled={!canDone}
            />
            <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[styles.editorContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
            >
                <Text style={[Type.sectionKicker, styles.fieldLabel, { color: palette.textMuted }]}>Prompt</Text>
                <View style={styles.chips}>
                    {QUICK_TAKE_PROMPTS.map((prompt) => {
                        const selected = draft.prompt_key === prompt.key;
                        const disabled = unavailablePrompts.has(prompt.key) && !selected;
                        return (
                            <PressableScale
                                key={prompt.key}
                                onPress={() => onChange({ ...draft, prompt_key: prompt.key })}
                                disabled={disabled}
                                scaleTo={0.96}
                                style={[
                                    styles.chip,
                                    {
                                        backgroundColor: selected
                                            ? palette.primaryMuted
                                            : palette.surfaceJournalLow,
                                        opacity: disabled ? 0.35 : 1,
                                    },
                                ]}
                                accessibilityRole="button"
                                accessibilityState={{ selected, disabled }}
                            >
                                <Text
                                    style={[
                                        Type.metadata,
                                        styles.chipLabel,
                                        { color: selected ? palette.primary : palette.textSecondary },
                                    ]}
                                >
                                    {prompt.label}
                                </Text>
                            </PressableScale>
                        );
                    })}
                </View>

                <Text style={[Type.sectionKicker, styles.fieldLabel, { color: palette.textMuted }]}>Restaurant</Text>
                <PressableScale
                    onPress={onChooseRestaurant}
                    scaleTo={0.96}
                    style={[styles.restaurantField, { backgroundColor: palette.card }, Shadow.subtle]}
                    accessibilityRole="button"
                >
                    <Ionicons name="restaurant-outline" size={22} color={palette.primary} />
                    <View style={styles.draftCopy}>
                        <Text style={[Type.editorialBody, { color: draft.name ? palette.text : palette.textMuted }]}>
                            {draft.name || 'choose a restaurant'}
                        </Text>
                        {draft.name && (draft.city || draft.cuisine) ? (
                            <Text style={[Type.metadata, { color: palette.textMuted }]}>
                                {[draft.city, draft.cuisine].filter(Boolean).join(' · ')}
                            </Text>
                        ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                </PressableScale>

                <View style={styles.noteHeader}>
                    <Text style={[Type.sectionKicker, { color: palette.textMuted }]}>Optional note</Text>
                    <Text style={[Type.metadata, { color: palette.textMuted }]}>{noteLength}/140</Text>
                </View>
                <TextInput
                    value={draft.note ?? ''}
                    onChangeText={(note) => onChange({ ...draft, note: trimQuickTakeNote(note) || null })}
                    placeholder="what should people know?"
                    placeholderTextColor={palette.textMuted}
                    multiline
                    maxLength={MAX_PROFILE_QUICK_TAKE_NOTE * 2}
                    style={[
                        styles.noteInput,
                        {
                            color: palette.text,
                            backgroundColor: palette.surfaceJournalLow,
                        },
                    ]}
                    textAlignVertical="top"
                />

                {isExisting ? (
                    <Pressable
                        onPress={onDelete}
                        style={styles.deleteButton}
                        accessibilityRole="button"
                    >
                        <Text style={[Type.body, { color: palette.error }]}>remove this take</Text>
                    </Pressable>
                ) : null}
            </ScrollView>
        </View>
    );
}

export function QuickTakesSheet({
    visible,
    onClose,
    userId,
    profileIdentifier,
    currentTakes,
}: Props) {
    const scheme = (useColorScheme() ?? 'light') as keyof typeof Colors;
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();
    const mutation = useSetProfileQuickTakes(profileIdentifier);
    const [drafts, setDrafts] = useState<ProfileQuickTake[]>([]);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editorDraft, setEditorDraft] = useState<ProfileQuickTake | null>(null);
    const [choosingRestaurant, setChoosingRestaurant] = useState(false);
    const [failedPhotoUrls, setFailedPhotoUrls] = useState<Set<string>>(() => new Set());
    const wasVisible = useRef(false);

    useEffect(() => {
        if (visible && !wasVisible.current) {
            setDrafts(currentTakes.map((take) => ({ ...take })));
            setEditingIndex(null);
            setEditorDraft(null);
            setChoosingRestaurant(false);
            setFailedPhotoUrls(new Set());
        }
        wasVisible.current = visible;
    }, [visible, currentTakes]);

    const hasDiff = useMemo(() => !sameTakes(drafts, currentTakes), [drafts, currentTakes]);
    const usedPrompts = useMemo(() => new Set(drafts.map((take) => take.prompt_key)), [drafts]);
    const availablePrompts = QUICK_TAKE_PROMPTS.filter((prompt) => !usedPrompts.has(prompt.key));
    const resolvedPhotosByPrompt = useMemo(() => new Map(
        drafts.map((take) => [take.prompt_key, resolveSourcedPhoto({
            url: take.photo_url,
            photoSource: take.photo_source,
            attributionHtml: take.places_photo_attribution_html,
            restaurantName: take.name,
        })]),
    ), [drafts]);

    const beginAdd = useCallback((promptKey?: QuickTakePromptKey) => {
        if (drafts.length >= MAX_PROFILE_QUICK_TAKES) return;
        const key = promptKey ?? availablePrompts[0]?.key;
        if (!key) return;
        setEditingIndex(null);
        setEditorDraft({
            prompt_key: key,
            position: drafts.length + 1,
            restaurant_id: '',
            name: '',
            city: null,
            cuisine: null,
            photo_url: null,
            photo_source: null,
            places_photo_attribution_html: null,
            note: null,
        });
    }, [availablePrompts, drafts.length]);

    const beginEdit = useCallback((index: number) => {
        setEditingIndex(index);
        setEditorDraft({ ...drafts[index] });
    }, [drafts]);

    const finishEditor = useCallback(() => {
        if (!editorDraft?.restaurant_id || !editorDraft.name) return;
        setDrafts((current) => {
            if (editingIndex == null) return [...current, editorDraft];
            const next = [...current];
            next[editingIndex] = editorDraft;
            return next;
        });
        setEditorDraft(null);
        setEditingIndex(null);
    }, [editingIndex, editorDraft]);

    const removeAt = useCallback((index: number) => {
        setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
    }, []);

    const moveDraft = useCallback((index: number, delta: -1 | 1) => {
        const target = index + delta;
        if (index < 0 || index >= drafts.length || target < 0 || target >= drafts.length) return;
        const next = [...drafts];
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved);
        setDrafts(next.map((take, itemIndex) => ({ ...take, position: itemIndex + 1 })));
        AccessibilityInfo.announceForAccessibility(
            `Moved ${moved.name} to position ${target + 1} of ${next.length}`,
        );
    }, [drafts]);

    const cancel = useCallback(() => {
        if (hasDiff) {
            Alert.alert('Discard changes?', undefined, [
                { text: 'Keep editing', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: onClose },
            ]);
        } else {
            onClose();
        }
    }, [hasDiff, onClose]);

    const save = useCallback(() => {
        if (!hasDiff) return;
        mutation.mutate(drafts, {
            onSuccess: onClose,
            onError: () => Alert.alert('Could not save', 'Try again in a moment.'),
        });
    }, [drafts, hasDiff, mutation, onClose]);

    const chooseRestaurant = useCallback((pick: RestaurantPickerPick) => {
        setEditorDraft((current) => current ? {
            ...current,
            restaurant_id: pick.restaurant_id,
            name: pick.name,
            city: pick.city,
            cuisine: pick.cuisine,
            // The profile refetch supplies a server-gated Places photo only.
            photo_url: null,
            photo_source: null,
            places_photo_attribution_html: null,
        } : current);
        setChoosingRestaurant(false);
    }, []);

    const unavailablePrompts = useMemo(() => {
        const keys = new Set(drafts.map((take, index) => index === editingIndex ? null : take.prompt_key));
        keys.delete(null);
        return keys as Set<QuickTakePromptKey>;
    }, [drafts, editingIndex]);

    const backFromEditor = useCallback(() => {
        setEditorDraft(null);
        setEditingIndex(null);
    }, []);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={choosingRestaurant ? () => setChoosingRestaurant(false) : editorDraft ? backFromEditor : cancel}
        >
            {choosingRestaurant ? (
                <RestaurantPickerScreen
                    title="Choose a restaurant"
                    userId={userId}
                    onBack={() => setChoosingRestaurant(false)}
                    onPick={chooseRestaurant}
                />
            ) : editorDraft ? (
                <TakeEditor
                    draft={editorDraft}
                    unavailablePrompts={unavailablePrompts}
                    isExisting={editingIndex != null}
                    palette={palette}
                    onChange={setEditorDraft}
                    onBack={backFromEditor}
                    onDone={finishEditor}
                    onChooseRestaurant={() => setChoosingRestaurant(true)}
                    onDelete={() => {
                        if (editingIndex != null) removeAt(editingIndex);
                        setEditorDraft(null);
                        setEditingIndex(null);
                    }}
                />
            ) : (
                <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
                    <SheetHeader
                        title="Quick takes"
                        onLeftPress={cancel}
                        onRightPress={save}
                        rightDisabled={!hasDiff || mutation.isPending}
                        rightPending={mutation.isPending}
                    />
                    <DraggableFlatList
                        data={drafts}
                        keyExtractor={(item) => item.prompt_key}
                        onDragEnd={({ data }) => setDrafts(data.map((take, index) => ({ ...take, position: index + 1 })))}
                        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
                        ListHeaderComponent={drafts.length > 1 ? (
                            <View style={styles.listHeader}>
                                <Text style={[Type.metadata, { color: palette.textMuted }]}>Hold ≡ to reorder.</Text>
                            </View>
                        ) : null}
                        renderItem={(params) => {
                            const index = params.getIndex() ?? 0;
                            const resolvedPhoto = resolvedPhotosByPrompt.get(params.item.prompt_key);
                            const photoUrl = resolvedPhoto?.url && !failedPhotoUrls.has(resolvedPhoto.url)
                                ? resolvedPhoto.url
                                : null;
                            return (
                                <DraftRow
                                    {...params}
                                    index={index}
                                    total={drafts.length}
                                    palette={palette}
                                    isDark={scheme === 'dark'}
                                    onEdit={() => beginEdit(index)}
                                    onRemove={() => removeAt(index)}
                                    onMove={(delta) => moveDraft(index, delta)}
                                    photoUrl={photoUrl}
                                    onPhotoError={() => {
                                        if (!photoUrl) return;
                                        setFailedPhotoUrls((current) => new Set(current).add(photoUrl));
                                    }}
                                />
                            );
                        }}
                        ListFooterComponent={drafts.length < MAX_PROFILE_QUICK_TAKES ? (
                            <View style={styles.promptBank}>
                                <Text style={[Type.sectionKicker, { color: palette.textMuted }]}>Add a take</Text>
                                <View style={styles.chips}>
                                    {availablePrompts.map((prompt) => (
                                        <PressableScale
                                            key={prompt.key}
                                            onPress={() => beginAdd(prompt.key)}
                                            scaleTo={0.96}
                                            style={[styles.chip, { backgroundColor: palette.surfaceJournalLow }]}
                                            accessibilityRole="button"
                                        >
                                            <Text style={[Type.metadata, styles.chipLabel, { color: palette.textSecondary }]}>
                                                {prompt.label}
                                            </Text>
                                        </PressableScale>
                                    ))}
                                </View>
                            </View>
                        ) : null}
                    />
                </View>
            )}
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    listContent: { paddingHorizontal: 22, paddingTop: Spacing.md, gap: 10 },
    listHeader: { gap: Spacing.xs, marginBottom: Spacing.xs },
    draftRow: {
        minHeight: 80,
        paddingVertical: Spacing.sm,
        paddingRight: 4,
        borderRadius: Radius.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    dragHandle: { width: 44, minHeight: 64, alignItems: 'center', justifyContent: 'center' },
    editArea: {
        flex: 1,
        minWidth: 0,
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    draftCopy: { flex: 1, minWidth: 0 },
    draftName: { marginTop: 3 },
    thumb: {
        width: 48,
        height: 56,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    thumbLetter: { fontFamily: 'Newsreader_600SemiBold', fontSize: 22 },
    removeButton: { width: 44, height: 56, alignItems: 'center', justifyContent: 'center' },
    promptBank: { marginTop: Spacing.lg, gap: 10 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    chip: {
        minHeight: 44,
        paddingHorizontal: 13,
        paddingVertical: 10,
        borderRadius: Radius.full,
        justifyContent: 'center',
    },
    chipLabel: { fontFamily: 'Manrope_600SemiBold' },
    editorContent: { paddingHorizontal: 22, paddingTop: Spacing.lg },
    fieldLabel: { marginBottom: 10 },
    restaurantField: {
        minHeight: 68,
        paddingHorizontal: Spacing.md,
        borderRadius: Radius.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: Spacing.lg,
    },
    noteHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    noteInput: {
        ...Type.editorialBody,
        minHeight: 112,
        paddingHorizontal: Spacing.md,
        paddingVertical: 14,
        borderRadius: Radius.lg,
    },
    deleteButton: { minHeight: 48, marginTop: Spacing.lg, alignItems: 'center', justifyContent: 'center' },
});
