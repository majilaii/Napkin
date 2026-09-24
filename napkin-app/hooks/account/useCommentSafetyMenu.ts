/**
 * Report or block from someone else's comment (TICKET-250, Guideline 1.2).
 *
 * Reviews and profiles already carried Report and Block; comments and replies
 * only offered their author Edit/Delete, so a reader had no way to flag one.
 * The account edge function already accepts target_type 'comment'. Same alert
 * grammar as the review menu in app/entry-detail.tsx.
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { isPlaceholderName } from '@/lib/onboardingName';
import { useBlockUser } from './useBlocking';
import { useReportContent } from './useReportContent';

export interface SafetyMenuComment {
    id: string;
    user_id: string;
    profiles?: { display_name?: string | null } | null;
}

/** The thread the comment sits in, so a block removes it from view at once. */
export interface SafetyMenuThread {
    targetType: string;
    targetId: string;
    scope?: 'table' | 'public';
}

export function useCommentSafetyMenu(thread?: SafetyMenuThread) {
    const reportContent = useReportContent();
    const blockUser = useBlockUser();
    const queryClient = useQueryClient();
    const threadType = thread?.targetType;
    const threadId = thread?.targetId;
    const threadScope = thread?.scope ?? 'table';

    return useCallback((comment: SafetyMenuComment) => {
        const rawName = comment.profiles?.display_name;
        const authorName = rawName && !isPlaceholderName(rawName) ? rawName : 'this person';
        const fileReport = (reason: string) => {
            reportContent.mutate(
                { targetType: 'comment', targetId: comment.id, reason },
                {
                    onSuccess: () => Alert.alert('Reported', 'Thanks, we review reports within 24 hours.'),
                    onError: () => Alert.alert('Something went wrong', 'Try again in a moment.'),
                },
            );
        };
        Alert.alert(authorName, undefined, [
            {
                text: 'Report this comment',
                style: 'destructive',
                onPress: () =>
                    Alert.alert('Report this comment', undefined, [
                        { text: 'Spam or misleading', onPress: () => fileReport('spam') },
                        { text: 'Offensive or abusive', onPress: () => fileReport('offensive') },
                        { text: 'Something else', onPress: () => fileReport('other') },
                        { text: 'Cancel', style: 'cancel' },
                    ]),
            },
            {
                text: `Block ${authorName}`,
                style: 'destructive',
                onPress: () =>
                    Alert.alert(
                        `Block ${authorName}?`,
                        "You won't see each other's reviews, comments, or profiles.",
                        [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Block',
                                style: 'destructive',
                                onPress: () =>
                                    blockUser.mutate(comment.user_id, {
                                        // The server filters blocked authors on the next read;
                                        // refetch this thread so the comment leaves now.
                                        onSuccess: () => {
                                            if (threadType && threadId) {
                                                void queryClient.invalidateQueries({
                                                    queryKey: queryKeys.postInteractions.all(threadType, threadId, threadScope),
                                                });
                                            }
                                        },
                                        onError: () => Alert.alert('Something went wrong', 'Try again in a moment.'),
                                    }),
                            },
                        ],
                    ),
            },
            { text: 'Cancel', style: 'cancel' },
        ]);
    }, [reportContent, blockUser, queryClient, threadType, threadId, threadScope]);
}
