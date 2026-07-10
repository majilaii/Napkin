/**
 * statsLine — the profile's one quiet counts line (TICKET-144 part 1).
 *
 * Replaces the five-column serif stats strip (MEALS · PLACES · THIS YR ·
 * FOLLOWERS · FOLLOWING) with a single muted Manrope line:
 *   "26 meals · 6 following · 1 follower"
 *
 * PLACES / THIS YR are gone (cities/countries live in the TASTE band). The
 * follower/following segments are tappable → /follows; meals is not. A `null`
 * count means "withheld / genuinely unknown" (a private tablemate whose stats
 * aren't shared) — that segment is OMITTED rather than shown as a lying 0.
 *
 * Pure (labels + which segments exist + which tap) so plural/omission logic is
 * unit-testable; the component owns the rendering + the /follows navigation.
 */

export type StatSegmentKey = 'meals' | 'following' | 'followers';

export interface StatSegment {
    key: StatSegmentKey;
    text: string;
    /** followers/following tap → /follows; meals never does. */
    tappable: boolean;
}

export interface StatCounts {
    /** total logs; null → withheld → omit the meals segment. */
    meals: number | null;
    /** null → unknown → omit. */
    following: number | null;
    /** null → unknown → omit. */
    followers: number | null;
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/**
 * Build the ordered, present-only segments: meals · following · follower(s).
 *
 * `countsInteractive` (default true): whether the follower/following segments tap
 * through to /follows. TICKET-155 passes `false` on the reachable private-account
 * stub tier — `follow_list` still 404s a non-tablemate viewer of a private
 * account, so a tappable count would dead-end. `meals` is never tappable.
 */
export function profileStatSegments(
    counts: StatCounts,
    opts?: { countsInteractive?: boolean },
): StatSegment[] {
    const countsInteractive = opts?.countsInteractive ?? true;
    const segments: StatSegment[] = [];
    if (counts.meals != null) {
        segments.push({ key: 'meals', text: plural(counts.meals, 'meal', 'meals'), tappable: false });
    }
    if (counts.following != null) {
        // "following" is invariant (no singular/plural swing).
        segments.push({ key: 'following', text: `${counts.following} following`, tappable: countsInteractive });
    }
    if (counts.followers != null) {
        segments.push({
            key: 'followers',
            text: plural(counts.followers, 'follower', 'followers'),
            tappable: countsInteractive,
        });
    }
    return segments;
}
