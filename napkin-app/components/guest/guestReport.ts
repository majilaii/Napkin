/**
 * Guest reporting (TICKET-247, App Store Guideline 1.2).
 *
 * Signed-out readers can see user content: public reviews, and public lists
 * with their titles, descriptions and notes. Each must be reportable. A guest
 * has no account, so a report is a mail to support that names exactly what is
 * being reported; when no mail app can take it (common on review devices), the
 * address and reference are shown with a copy action and the support page.
 */
import { Alert, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { LEGAL_URLS, SUPPORT_EMAIL } from '@/constants/links';

export type ReportTarget =
    | {
        kind: 'review';
        restaurant: { id: string; name: string };
        /** Absent for the page-level line: the reader says which review. */
        review?: { entry_id: string; display_name: string };
    }
    | {
        kind: 'list';
        list: { id: string; title: string };
        ownerName: string | null;
    };

/** The reference a moderator needs to find the content. */
export function reportReference(target: ReportTarget): string {
    if (target.kind === 'list') {
        const owner = target.ownerName ? ` by ${target.ownerName}` : '';
        return `List: ${target.list.title} (${target.list.id})${owner}`;
    }
    const lines = [`Restaurant: ${target.restaurant.name} (${target.restaurant.id})`];
    lines.push(target.review
        ? `Review: ${target.review.entry_id} by ${target.review.display_name}`
        : 'Which review:');
    return lines.join('\n');
}

function reportTitle(target: ReportTarget): string {
    return target.kind === 'list' ? 'Report list' : 'Report review';
}

export function reportMailto(target: ReportTarget): string {
    const subject = encodeURIComponent(
        target.kind === 'list' ? 'Report a list on Napkin' : 'Report a review on Napkin',
    );
    const body = `${reportReference(target)}\n\nWhat is wrong:`;
    return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${encodeURIComponent(body)}`;
}

/** Open the report mail, or never fail silently: show the fallback alert. */
export function sendReport(target: ReportTarget): void {
    const reference = reportReference(target);
    Linking.openURL(reportMailto(target)).catch(() => {
        Alert.alert(
            reportTitle(target),
            `Email ${SUPPORT_EMAIL} with this reference.\n\n${reference}`,
            [
                {
                    text: 'Copy details',
                    onPress: () => {
                        void Clipboard.setStringAsync(`To: ${SUPPORT_EMAIL}\n${reference}`)
                            .catch(() => undefined);
                    },
                },
                {
                    text: 'Support page',
                    onPress: () => {
                        void Linking.openURL(LEGAL_URLS.support).catch(() => undefined);
                    },
                },
                { text: 'Close', style: 'cancel' },
            ],
        );
    });
}
