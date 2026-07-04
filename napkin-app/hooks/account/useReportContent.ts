/**
 * useReportContent (TICKET-090, guideline 1.2) — file a report against a piece
 * of content or a user. Fire-and-forget from the caller's perspective; reports
 * land in content_reports for operator review (no client-readable state).
 */
import { useMutation } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';

export type ReportTargetType = 'entry' | 'comment' | 'profile' | 'share' | 'supper' | 'photo';

export interface ReportInput {
    targetType: ReportTargetType;
    targetId: string;
    reason: string;
}

export function useReportContent() {
    return useMutation({
        mutationFn: async ({ targetType, targetId, reason }: ReportInput) => {
            await callEdgeFn('account', {
                action: 'report',
                body: { target_type: targetType, target_id: targetId, reason },
            });
        },
    });
}
