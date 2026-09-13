/**
 * Create a Table, then send pending invitations to the selected mutual friends.
 * Membership still starts only after each invitation is accepted. The link
 * action creates the Table, mints a real invite, and opens the native share sheet.
 * The form keeps both creation actions behind the same name and pending guards.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    useWindowDimensions,
    ActivityIndicator,
    Alert,
    Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Colors, IconSize, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useCreateTable } from '@/hooks/tables/useCreateTable';
import { useAddMember } from '@/hooks/tables/useAddMember';
import { useCreateInvite } from '@/hooks/tables/useCreateInvite';
import { TESTFLIGHT_INVITE_URL } from '@/constants/links';
import { useUserSearch, type UserSearchResult } from '@/hooks/users/useUserSearch';
import { Avatar } from '@/components/feed/Avatar';
import {
    CREATE_TABLE_COPY,
    CREATE_TABLE_NAME_TYPE,
    getCreateTableKeyboardOffset,
} from '@/components/tables/createTablePresentation';

type Palette = typeof Colors.light;

interface PickedMember {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
}

export default function CreateTableScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const [rootHeight, setRootHeight] = useState<number | null>(null);
    const router = useRouter();
    const { user } = useAuth();

    const [name, setName] = useState('');
    const [nameFocused, setNameFocused] = useState(false);
    const [picked, setPicked] = useState<PickedMember[]>([]);
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [searchFocused, setSearchFocused] = useState(false);
    const [creating, setCreating] = useState(false);

    const createTable = useCreateTable(user?.id);
    const addMember = useAddMember(user?.id);
    const createInvite = useCreateInvite();
    const toast = useToast();
    const nameInputRef = useRef<TextInput>(null);

    // Debounce the search query (250ms).
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
        return () => clearTimeout(t);
    }, [query]);

    const { data: results, isFetching } = useUserSearch(
        debouncedQuery,
        debouncedQuery.length > 0,
        { mutualOnly: true },
    );

    const nameTrimmed = name.trim();
    const canCreate = nameTrimmed.length > 0 && !creating;
    const pickedIds = useMemo(() => new Set(picked.map((p) => p.user_id)), [picked]);
    const searching = debouncedQuery.length > 0;

    const togglePick = useCallback((row: UserSearchResult) => {
        setPicked((prev) => {
            if (prev.some((p) => p.user_id === row.user_id)) {
                return prev.filter((p) => p.user_id !== row.user_id);
            }
            return [
                ...prev,
                { user_id: row.user_id, display_name: row.display_name, avatar_url: row.avatar_url },
            ];
        });
    }, []);

    const removePick = useCallback((userId: string) => {
        setPicked((prev) => prev.filter((p) => p.user_id !== userId));
    }, []);

    // Create the table + best-effort INVITE each picked mutual (pending until
    // they accept — TICKET-133 consent gate). Shared by the Create-table CTA and
    // the Invite-by-link row. A single invite failure (e.g. follow changed since
    // search) must not block the table.
    const runCreate = useCallback(async () => {
        const table = await createTable.mutateAsync({ name: nameTrimmed });
        if (picked.length > 0) {
            const outcomes = await Promise.allSettled(
                picked.map((p) =>
                    addMember.mutateAsync({ tableId: table.id, targetUserId: p.user_id }),
                ),
            );
            const failed = outcomes.filter((o) => o.status === 'rejected').length;
            const invited = picked.length - failed;
            if (failed > 0) {
                Alert.alert(
                    'Table created',
                    failed === 1
                        ? "One person couldn't be invited — you can try again from the table."
                        : `${failed} people couldn't be invited — you can try again from the table.`,
                );
            } else if (invited > 0) {
                // One short line on the masthead: invites went out, nobody is
                // seated yet (the roster shows the creator alone until accepts).
                toast.show(`${invited} invited`);
            }
        }
        return table;
    }, [createTable, nameTrimmed, picked, addMember, toast]);

    const handleCreate = useCallback(async () => {
        if (!canCreate) return;
        setCreating(true);
        try {
            const table = await runCreate();
            router.replace({ pathname: '/(tabs)/tables', params: { selected: table.id } });
        } catch {
            setCreating(false);
            Alert.alert('Could not create table', 'Please try again in a moment.');
        }
    }, [canCreate, runCreate, router]);

    // Invite-by-link: create the table, mint a real invite code, open the share
    // sheet, then land on the founded masthead (same destination as Create).
    const handleInviteByLink = useCallback(async () => {
        if (creating) return;
        if (!nameTrimmed) {
            nameInputRef.current?.focus();
            return;
        }
        setCreating(true);
        try {
            const table = await runCreate();
            // A failed mint/share must not strand the user — the table exists.
            try {
                const { join_url } = await createInvite.mutateAsync(table.id);
                await Share.share({
                    message: TESTFLIGHT_INVITE_URL
                        ? `join "${nameTrimmed}" on Napkin — ${join_url}\n\n${TESTFLIGHT_INVITE_URL}`
                        : `join "${nameTrimmed}" on Napkin — ${join_url}`,
                });
            } catch {
                // no-op — table already created; fall through to routing.
            }
            router.replace({ pathname: '/(tabs)/tables', params: { selected: table.id } });
        } catch {
            setCreating(false);
            Alert.alert('Could not create table', 'Please try again in a moment.');
        }
    }, [creating, nameTrimmed, runCreate, createInvite, router]);

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: palette.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? getCreateTableKeyboardOffset(windowHeight, rootHeight) : 0}
            onLayout={(event) => setRootHeight(event.nativeEvent.layout.height)}
        >
            <View style={styles.handleWrap}>
                <View style={[styles.handle, { backgroundColor: palette.ruleInkSoft }]} />
            </View>
            <View style={styles.header}>
                <Pressable
                    onPress={() => router.back()}
                    disabled={creating}
                    style={({ pressed }) => [styles.headerControl, { opacity: creating ? 0.5 : pressed ? 0.7 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    accessibilityState={{ disabled: creating }}
                >
                    <Ionicons name="arrow-back-outline" size={IconSize.lg} color={palette.text} />
                </Pressable>
                <Text style={[Type.headlineLarge, { color: palette.text }]}>Napkin</Text>
                <View style={styles.headerControl} />
            </View>
            <ScrollView
                style={styles.flex}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                automaticallyAdjustKeyboardInsets={false}
                showsVerticalScrollIndicator={false}
            >
                <Text accessibilityRole="header" style={[Type.displayLarge, styles.title, { color: palette.text }]}>
                    {CREATE_TABLE_COPY.title}
                </Text>
                <Text style={[Type.body, styles.description, { color: palette.textSecondary }]}>
                    A private space for your people.
                </Text>

                <View style={[styles.paper, Shadow.note, { backgroundColor: palette.surfaceNote }]}>
                    <TextInput
                        ref={nameInputRef}
                        value={name}
                        onChangeText={setName}
                        onFocus={() => setNameFocused(true)}
                        onBlur={() => setNameFocused(false)}
                        placeholder={CREATE_TABLE_COPY.namePlaceholder}
                        placeholderTextColor={palette.textMuted}
                        accessibilityLabel="Table name"
                        style={[CREATE_TABLE_NAME_TYPE, styles.nameInput, { color: palette.text, borderBottomColor: nameFocused ? palette.primary : palette.ruleInkSoft }]}
                        selectionColor={palette.primary}
                        autoCapitalize="words"
                        autoCorrect={false}
                        returnKeyType="done"
                        maxLength={60}
                        editable={!creating}
                    />
                </View>

                <View style={[styles.inviteSection, styles.paper, { backgroundColor: palette.surfaceJournalLow }]}>
                    <View style={styles.inviteHeader}>
                        <Text style={[Type.sectionTitle, styles.flex, { color: palette.text }]}>
                            {CREATE_TABLE_COPY.inviteLabel}
                        </Text>
                        <Text style={[Type.metadata, { color: palette.textMuted }]}>
                            {picked.length > 0 ? `${picked.length} selected` : 'Optional'}
                        </Text>
                    </View>
                    {picked.length > 0 ? (
                        <View style={styles.chipsRow}>
                            {picked.map((p) => (
                                <Pressable
                                    key={p.user_id}
                                    onPress={() => removePick(p.user_id)}
                                    disabled={creating}
                                    style={({ pressed }) => [styles.chip, { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.85 : 1 }]}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Remove ${p.display_name} from selection`}
                                    accessibilityState={{ disabled: creating }}
                                >
                                    <Avatar name={p.display_name} url={p.avatar_url} size={Spacing.lg} palette={palette} />
                                    <Text style={[Type.metadata, styles.chipName, { color: palette.text }]} numberOfLines={1}>
                                        {p.display_name}
                                    </Text>
                                    <Ionicons name="close-outline" size={IconSize.md} color={palette.textMuted} />
                                </Pressable>
                            ))}
                        </View>
                    ) : null}
                    <View style={[styles.searchRow, { backgroundColor: palette.surfaceNote, borderBottomColor: searchFocused ? palette.primary : palette.ruleInkSoft }]}>
                        <Ionicons name="search-outline" size={IconSize.lg} color={palette.textMuted} />
                        <TextInput
                            value={query}
                            onChangeText={setQuery}
                            onFocus={() => setSearchFocused(true)}
                            onBlur={() => setSearchFocused(false)}
                            placeholder="Search mutual friends"
                            placeholderTextColor={palette.textMuted}
                            accessibilityLabel="Search mutual friends"
                            style={[Type.body, styles.searchInput, { color: palette.text }]}
                            selectionColor={palette.primary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            returnKeyType="search"
                            editable={!creating}
                        />
                        {query.length > 0 ? (
                            <Pressable
                                onPress={() => setQuery('')}
                                disabled={creating}
                                style={styles.clearSearch}
                                accessibilityRole="button"
                                accessibilityLabel="Clear search"
                                accessibilityState={{ disabled: creating }}
                            >
                                <Ionicons name="close-outline" size={IconSize.md} color={palette.textMuted} />
                            </Pressable>
                        ) : null}
                    </View>
                    {searching ? (
                        (results?.length ?? 0) > 0 ? (
                            <View style={styles.resultsWrap}>
                                {(results ?? []).map((row) => (
                                    <ResultRow
                                        key={row.user_id}
                                        row={row}
                                        palette={palette}
                                        selected={pickedIds.has(row.user_id)}
                                        disabled={creating}
                                        onToggle={() => togglePick(row)}
                                    />
                                ))}
                            </View>
                        ) : isFetching ? (
                            <View style={styles.centerBlock}>
                                <ActivityIndicator color={palette.primary} accessibilityLabel="Searching friends" />
                            </View>
                        ) : (
                            <Text style={[Type.metadata, styles.emptyLine, { color: palette.textMuted }]}>
                                {CREATE_TABLE_COPY.emptyMutuals}
                            </Text>
                        )
                    ) : null}
                    {picked.length > 0 ? (
                        <Text style={[Type.metadata, styles.inviteNote, { color: palette.textSecondary }]}>
                            Invitations go out when you create your Table.
                        </Text>
                    ) : null}
                </View>

                <Pressable
                    onPress={handleInviteByLink}
                    disabled={creating}
                    style={({ pressed }) => [styles.linkAction, { opacity: creating ? 0.5 : pressed ? 0.85 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Create table and share invite link"
                    accessibilityState={{ disabled: creating }}
                >
                    <Ionicons name="link-outline" size={IconSize.lg} color={palette.primary} />
                    <Text style={[Type.body, { color: palette.primary }]}>Create &amp; share a link</Text>
                </Pressable>
            </ScrollView>

            <View style={[styles.ctaBar, { backgroundColor: palette.background, paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
                <Pressable
                    onPress={handleCreate}
                    disabled={!canCreate}
                    style={({ pressed }) => [styles.ctaBtn, { backgroundColor: palette.primary, opacity: !canCreate ? 0.5 : pressed ? 0.85 : 1 }]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canCreate, busy: creating }}
                    accessibilityLabel="Create table"
                >
                    {creating ? <ActivityIndicator color={palette.textInverse} /> : null}
                    <Text style={[Type.titleMedium, { color: palette.textInverse }]}>
                        {creating ? 'Creating Table…' : 'Create Table'}
                    </Text>
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}

function ResultRow({ row, palette, selected, disabled, onToggle }: {
    row: UserSearchResult;
    palette: Palette;
    selected: boolean;
    disabled: boolean;
    onToggle: () => void;
}) {
    const isMutual = row.is_mutual !== false;
    return (
        <View style={styles.resultRow}>
            <Avatar name={row.display_name} url={row.avatar_url} size={Spacing.hitTarget} palette={palette} />
            <View style={styles.resultText}>
                <Text style={[Type.titleMedium, { color: palette.text }]}>{row.display_name}</Text>
                {!isMutual ? <Text style={[Type.metadata, { color: palette.textMuted }]}>Needs to follow you back</Text> : null}
            </View>
            {isMutual ? (
                <Pressable
                    onPress={onToggle}
                    disabled={disabled}
                    style={({ pressed }) => [styles.selectButton, { backgroundColor: selected ? palette.surfaceJournal : palette.surfaceNote, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel={selected ? `Remove ${row.display_name} from selection` : `Select ${row.display_name}`}
                    accessibilityState={{ selected, disabled }}
                >
                    <Text style={[Type.metadata, { color: selected ? palette.textSecondary : palette.primary }]}>
                        {selected ? 'Selected' : 'Select'}
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    flex: { flex: 1 },
    handleWrap: { alignItems: 'center', paddingTop: Spacing.md, paddingBottom: Spacing.sm },
    handle: { width: Spacing.xl, height: Spacing.xs, borderRadius: Radius.full },
    header: { paddingHorizontal: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerControl: { minWidth: Spacing.hitTarget, minHeight: Spacing.hitTarget, alignItems: 'center', justifyContent: 'center' },
    scrollContent: { padding: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xl },
    title: { marginBottom: Spacing.md },
    description: { marginBottom: Spacing.xl },
    paper: { padding: Spacing.lg, borderRadius: Radius.xl },
    nameInput: { minHeight: Spacing.xxl, paddingVertical: Spacing.sm, borderBottomWidth: 1 },
    inviteSection: { marginTop: Spacing.lg },
    inviteHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
    chip: { minHeight: Spacing.hitTarget, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm, borderRadius: Radius.full },
    chipName: { flexShrink: 1 },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md, paddingLeft: Spacing.md, borderRadius: Radius.md, borderBottomWidth: 1 },
    searchInput: { flex: 1, minHeight: Spacing.hitTarget + Spacing.sm, paddingVertical: Spacing.sm },
    clearSearch: { minWidth: Spacing.hitTarget, minHeight: Spacing.hitTarget, alignItems: 'center', justifyContent: 'center' },
    resultsWrap: { marginTop: Spacing.md, gap: Spacing.md },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    resultText: { flex: 1, minWidth: 0 },
    selectButton: { minHeight: Spacing.hitTarget, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full },
    centerBlock: { minHeight: Spacing.xxl, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md },
    emptyLine: { marginTop: Spacing.md },
    inviteNote: { marginTop: Spacing.md },
    linkAction: { minHeight: Spacing.hitTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.md, paddingVertical: Spacing.sm },
    ctaBar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
    ctaBtn: { minHeight: Spacing.hitTarget + Spacing.sm, padding: Spacing.md, borderRadius: Radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
});
