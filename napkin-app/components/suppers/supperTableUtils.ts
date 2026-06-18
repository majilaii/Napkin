/**
 * supperTableUtils — pure derivations for the Supper "at the table" accordion
 * (TICKET-082). Extracted from SupperTable.tsx so the roster-exclusion, take
 * lookup, and group-average rules have zero-UI jest coverage.
 */
import type { SupperDetail, SupperRosterMember, SupperTake } from '@/hooks/suppers';

export interface SupperTableRow {
    member: SupperRosterMember;
    take?: SupperTake;
}

export interface SupperTableModel {
    /** Roster minus the centerpiece author — everyone ELSE at the table. */
    rows: SupperTableRow[];
    /** Header count = full roster size (incl. host + centerpiece author). */
    headCount: number;
    /** Mean of ALL submitted takes' ratings (sibling signal), or null if none rated. */
    groupAverage: number | null;
}

/**
 * Build the accordion model. The centerpiece author is excluded from `rows`
 * (they're the hero above), but they DO count toward headCount and the group
 * average (their take is one of the submitted takes).
 */
export function buildSupperTableModel(
    detail: SupperDetail,
    centerpieceUserId: string,
): SupperTableModel {
    const takeByUser = new Map(detail.takes.map((t) => [t.user_id, t]));

    const rows: SupperTableRow[] = detail.roster
        .filter((m) => m.user_id !== centerpieceUserId)
        .map((member) => ({ member, take: takeByUser.get(member.user_id) }));

    const rated = detail.takes
        .filter((t) => t.rating != null)
        .map((t) => t.rating as number);
    const groupAverage =
        rated.length > 0 ? rated.reduce((a, b) => a + b, 0) / rated.length : null;

    return {
        rows,
        headCount: detail.roster.length,
        groupAverage,
    };
}
