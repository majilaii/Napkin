/**
 * buildTasteSummary — rule-based, pure function.
 *
 * Produces a single-line taste summary string from a member's stats.
 * No LLM, no network, deterministic. Called client-side after data loads.
 *
 * Rules (approved set):
 *  1. entryCount < 3  → "New to the table · N entry/entries so far"
 *  2. Base clause: "Averages X.X · N entries"
 *  3. stdDev < 0.4 && entryCount >= 5  → append "Steady rater"
 *  4. stdDev > 0.9 && entryCount >= 5  → append "Strong opinions"
 *     (3 and 4 are mutually exclusive by threshold)
 *  5. avg >= 4.2 && entryCount >= 5    → append "Generous grader"
 *  6. avg <= 3.0 && entryCount >= 5    → append "Tough room"
 *     (5 and 6 are mutually exclusive by threshold)
 *
 * Separator: " · ". Max 3 clauses total (base + up to 2 qualifiers).
 */

import type { MemberStats } from '@/hooks/members/useMemberProfile';

export function buildTasteSummary(stats: MemberStats): string {
    const { avg, entry_count, std_dev } = stats;

    // Not enough data
    if (entry_count < 3) {
        const noun = entry_count === 1 ? 'entry' : 'entries';
        return `New to the table · ${entry_count} ${noun} so far`;
    }

    // No ratings at all (all entries were unrated)
    if (avg == null) {
        const noun = entry_count === 1 ? 'entry' : 'entries';
        return `${entry_count} ${noun} so far`;
    }

    const clauses: string[] = [];

    // Base clause
    const entryNoun = entry_count === 1 ? 'entry' : 'entries';
    clauses.push(`Averages ${avg.toFixed(1)} · ${entry_count} ${entryNoun}`);

    // Distribution qualifier (mutually exclusive)
    if (std_dev != null && entry_count >= 5) {
        if (std_dev < 0.4) {
            clauses.push('Steady rater');
        } else if (std_dev > 0.9) {
            clauses.push('Strong opinions');
        }
    }

    // Grading style qualifier (mutually exclusive)
    if (entry_count >= 5) {
        if (avg >= 4.2) {
            clauses.push('Generous grader');
        } else if (avg <= 3.0) {
            clauses.push('Tough room');
        }
    }

    return clauses.join(' · ');
}
