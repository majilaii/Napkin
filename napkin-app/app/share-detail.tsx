/**
 * share-detail — the thread for a shared_save (a restaurant a Tablemate posted to
 * the Table feed). Makes a share a first-class post: react with any emoji and reply
 * ("let's go", "next weekend?") instead of the old single 👀 "I'm in" toggle.
 *
 * Reuses the post-interaction stack with targetType='table_share', scope='table':
 * usePostInteractions / useToggleReaction / useAddComment / CommentRow. The share's
 * display data (author, restaurant, note) is passed via params so the header renders
 * without an extra fetch; reactions + comments load live.
 *
 * The author can retract the share here (useRemoveShare) — the orphan fix.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Image,
    ScrollView,
    TextInput,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import {
    usePostInteractions,
    useToggleReaction,
    useAddComment,
} from '@/hooks/posts/usePostInteractions';
import { useRemoveShare } from '@/hooks/posts/useRemoveShare';
import { CommentRow } from '@/components/posts/CommentRow';
import { safeRandomUUID } from '@/lib/uuid';

const EMOJIS = ['🔥', '😋', '❤️', '💯', '👀'] as const;

interface SharePayload {
    author?: { user_id?: string; display_name?: string | null; avatar_url?: string | null };
    restaurant?: { id?: string | null; name?: string | null; city?: string | null; cuisine?: string | null; photo_url?: string | null } | null;
    note?: string | null;
}

export default function ShareDetailScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { shareId, tableId, share: shareParam } = useLocalSearchParams<{
        shareId?: string;
        tableId?: string;
        share?: string;
    }>();

    const share: SharePayload = useMemo(() => {
        if (shareParam) {
            try { return JSON.parse(shareParam); } catch { /* fall through */ }
        }
        return {};
    }, [shareParam]);

    const isOwn = !!(user?.id && share.author?.user_id && user.id === share.author.user_id);

    const { data: interactions } = usePostInteractions(
        shareId ? 'table_share' : null,
        shareId ?? null,
        'table',
    );
    const toggleReaction = useToggleReaction();
    const addComment = useAddComment();
    const removeShare = useRemoveShare();

    const [body, setBody] = useState('');
    // TICKET-085: reply target (parentCommentId = thread root; name for the chip).
    const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
    const inputRef = useRef<TextInput>(null);

    const myReactions = useMemo(
        () => new Set((interactions?.reactions ?? []).filter((r: any) => r.user_id === user?.id).map((r: any) => r.emoji)),
        [interactions?.reactions, user?.id],
    );
    const countFor = useCallback(
        (emoji: string) =>
            (interactions?.counts?.top_emojis ?? []).find((t: any) => t.emoji === emoji)?.count ?? 0,
        [interactions?.counts?.top_emojis],
    );

    const handleReact = useCallback(
        (emoji: string) => {
            if (!shareId) return;
            toggleReaction.mutate({ targetType: 'table_share', targetId: shareId, emoji, tableId, scope: 'table' });
        },
        [toggleReaction, shareId, tableId],
    );

    const handleSend = useCallback(() => {
        const trimmed = body.trim();
        if (!trimmed || !shareId) return;
        setBody('');
        addComment.mutate({
            targetType: 'table_share',
            targetId: shareId,
            body: trimmed,
            scope: 'table',
            tableId,
            clientNonce: safeRandomUUID(),
            parentCommentId: replyingTo?.id,
        });
        setReplyingTo(null);
    }, [body, addComment, shareId, tableId, replyingTo]);

    const handleRemove = useCallback(() => {
        if (!isOwn || !shareId) return;
        Alert.alert(
            'Remove from table?',
            'This takes your shared restaurant out of the Table feed. Reactions and replies go with it.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () =>
                        removeShare.mutate(
                            { shareId },
                            {
                                onSuccess: () => router.back(),
                                onError: (err: any) =>
                                    Alert.alert('Error', err?.message ?? 'Could not remove this share.'),
                            },
                        ),
                },
            ],
        );
    }, [isOwn, shareId, removeShare, router]);

    const comments = interactions?.comments ?? [];
    // TICKET-085: group into one level of nesting — roots + replies-by-root.
    const rootComments = comments.filter((c: any) => !c.parent_id);
    const rootIdSet = new Set(rootComments.map((c: any) => c.id));
    const repliesByRoot = new Map<string, any[]>();
    const orphanReplies: any[] = [];
    for (const c of comments) {
        if (!c.parent_id) continue;
        if (rootIdSet.has(c.parent_id)) {
            const arr = repliesByRoot.get(c.parent_id) ?? [];
            arr.push(c);
            repliesByRoot.set(c.parent_id, arr);
        } else {
            orphanReplies.push(c);
        }
    }
    const threadRoots = [...rootComments, ...orphanReplies];
    const startReply = (rootId: string, name: string) => {
        setReplyingTo({ id: rootId, name });
        setTimeout(() => inputRef.current?.focus(), 50);
    };
    const cityLine = [share.restaurant?.city, share.restaurant?.cuisine].filter(Boolean).join(' · ');

    return (
        <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: palette.background }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <View style={{ paddingTop: insets.top + Spacing.xs }}>
                <Pressable onPress={() => router.back()} style={styles.breadcrumb} hitSlop={12} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={18} color={palette.textSecondary} />
                    <Text style={[styles.breadcrumbLabel, { color: palette.textSecondary }]}>back</Text>
                </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xl }} keyboardShouldPersistTaps="handled">
                {/* Share header */}
                <View style={styles.headerWrap}>
                    <View style={styles.authorRow}>
                        {share.author?.avatar_url ? (
                            <Image source={{ uri: share.author.avatar_url }} style={styles.avatar} />
                        ) : (
                            <View style={[styles.avatar, { backgroundColor: palette.surfaceContainerHigh }]} />
                        )}
                        <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                            <Text style={{ color: palette.text }}>{share.author?.display_name ?? 'someone'}</Text>
                            {' shared'}
                        </Text>
                    </View>

                    {/* Text-led restaurant row — NO photo thumbnail/placeholder
                        (restaurant/Google imagery removed; owner entry photos or
                        nothing — doctrine locked 2026-07-05). */}
                    <Pressable
                        onPress={() => share.restaurant?.id && router.push(`/restaurant/${share.restaurant.id}`)}
                        style={styles.restaurantRow}
                    >
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.restaurantName, { color: palette.text }]} numberOfLines={2}>
                                {share.restaurant?.name ?? 'Unknown restaurant'}
                            </Text>
                            {cityLine ? (
                                <Text style={[Type.bodySmall, { color: palette.textMuted }]} numberOfLines={1}>{cityLine}</Text>
                            ) : null}
                        </View>
                    </Pressable>

                    {share.note ? (
                        <Text style={[styles.note, { color: palette.text }]}>{`— ${share.note}`}</Text>
                    ) : null}

                    {/* Reaction row — any emoji, not a single "I'm in" */}
                    <View style={styles.reactionRow}>
                        {EMOJIS.map((e) => {
                            const active = myReactions.has(e);
                            const n = countFor(e);
                            return (
                                <Pressable
                                    key={e}
                                    onPress={() => handleReact(e)}
                                    style={[
                                        styles.reactionPill,
                                        {
                                            backgroundColor: active ? palette.primaryMuted : palette.surfaceJournalLow,
                                        },
                                    ]}
                                    accessibilityLabel={`react ${e}`}
                                >
                                    <Text style={styles.reactionEmoji}>{e}</Text>
                                    {n > 0 ? (
                                        <Text style={[styles.reactionCount, { color: active ? palette.primary : palette.textMuted }]}>{n}</Text>
                                    ) : null}
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                {/* Comments */}
                <View style={styles.commentsWrap}>
                    {comments.length === 0 ? (
                        <Text style={[Type.bodySmall, { color: palette.textMuted, paddingHorizontal: 14, paddingVertical: Spacing.sm }]}>
                            {'be the first to say something — “let’s go?”'}
                        </Text>
                    ) : (
                        threadRoots.map((root: any) => (
                            <React.Fragment key={root.id}>
                                <CommentRow
                                    comment={root}
                                    targetType="table_share"
                                    targetId={shareId!}
                                    scope="table"
                                    onReply={() => startReply(root.id, root.profiles?.display_name ?? 'Someone')}
                                />
                                {(repliesByRoot.get(root.id) ?? []).map((reply: any) => (
                                    <CommentRow
                                        key={reply.id}
                                        comment={reply}
                                        targetType="table_share"
                                        targetId={shareId!}
                                        scope="table"
                                        isReply
                                        onReply={() => startReply(root.id, reply.profiles?.display_name ?? 'Someone')}
                                    />
                                ))}
                            </React.Fragment>
                        ))
                    )}
                </View>

                {/* Author retract */}
                {isOwn && (
                    <Pressable
                        onPress={handleRemove}
                        disabled={removeShare.isPending}
                        style={({ pressed }) => [styles.removeRow, { opacity: pressed ? 0.6 : 1 }]}
                        accessibilityRole="button"
                        accessibilityLabel="Remove from table"
                    >
                        {removeShare.isPending ? (
                            <ActivityIndicator size="small" color={palette.textMuted} />
                        ) : (
                            <>
                                <Ionicons name="trash-outline" size={15} color={palette.textMuted} />
                                <Text style={[styles.removeLabel, { color: palette.textMuted }]}>remove from table</Text>
                            </>
                        )}
                    </Pressable>
                )}
            </ScrollView>

            {/* Composer */}
            {replyingTo ? (
                <View style={[styles.replyChip, { backgroundColor: palette.surfaceJournalLow }]}>
                    <Text style={[styles.replyChipText, { color: palette.textSecondary }]} numberOfLines={1}>
                        {'Replying to '}
                        <Text style={{ fontFamily: 'Manrope_700Bold', color: palette.text }}>{replyingTo.name}</Text>
                    </Text>
                    <Pressable onPress={() => setReplyingTo(null)} hitSlop={8} accessibilityLabel="Cancel reply">
                        <Ionicons name="close" size={14} color={palette.textMuted} />
                    </Pressable>
                </View>
            ) : null}
            <View
                style={[
                    styles.composer,
                    { borderTopColor: palette.divider, paddingBottom: Math.max(insets.bottom, Spacing.sm) },
                ]}
            >
                <TextInput
                    ref={inputRef}
                    style={[styles.input, { color: palette.text, backgroundColor: palette.surfaceJournalLow }]}
                    value={body}
                    onChangeText={setBody}
                    placeholder="say something…"
                    placeholderTextColor={palette.textMuted}
                    multiline
                />
                <Pressable
                    onPress={handleSend}
                    disabled={!body.trim()}
                    style={[styles.send, { backgroundColor: body.trim() ? palette.primary : palette.surfaceContainerHigh }]}
                    accessibilityLabel="Send"
                >
                    <Ionicons name="arrow-up" size={18} color={body.trim() ? '#fffdf8' : palette.textMuted} />
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 14, paddingBottom: Spacing.sm },
    breadcrumbLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
    headerWrap: { paddingHorizontal: 14, paddingBottom: Spacing.md },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.sm },
    avatar: { width: 26, height: 26, borderRadius: 13 },
    restaurantRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
    restaurantName: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 20, lineHeight: 24 },
    note: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 16, lineHeight: 24, marginBottom: Spacing.md },
    reactionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    reactionPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, minHeight: 34 },
    reactionEmoji: { fontSize: 15 },
    reactionCount: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
    commentsWrap: { borderTopWidth: 1, borderTopColor: 'rgba(28,28,25,0.06)', paddingTop: Spacing.sm },
    removeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.lg, paddingVertical: Spacing.md },
    removeLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
    replyChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginHorizontal: 14, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.sm, marginBottom: 4 },
    replyChipText: { fontFamily: 'Manrope_400Regular', fontSize: 12, flex: 1 },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 14, paddingTop: Spacing.sm, borderTopWidth: 1 },
    input: { flex: 1, minHeight: 38, maxHeight: 120, borderRadius: 19, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontFamily: 'Newsreader_400Regular_Italic', fontSize: 16 },
    send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
