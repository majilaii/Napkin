/**
 * TICKET-044: Shared round hydrator.
 *
 * projectRound(row, supabase) — builds the canonical participants[] shape
 * from either a live round (table_night_participants) or a merged round
 * (round_entries → entries → profiles).
 *
 * Called from: table-activity, user-profile (diary), restaurant-history,
 * table-atlas. Centralising prevents hydration drift across surfaces.
 *
 * [ARCH-REVIEW] verified:
 *   - round_kind is the subtype discriminator ('live' | 'merged').
 *   - Live → table_night_participants JOIN profiles.
 *   - Merged → round_entries JOIN entries JOIN profiles.
 *   - No auth.uid() calls.
 */

export type RoundParticipant = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    rating: number | null;
    notes: string | null;
};

export type ProjectedRound = {
    round_kind: 'live' | 'merged';
    participants: RoundParticipant[];
    average_rating: number | null;
};

/**
 * Hydrate a table_nights row into the canonical participants[] shape.
 *
 * @param roundId   - The table_nights.id
 * @param roundKind - 'live' | 'merged' (from table_nights.kind)
 * @param supabase  - Service-role Supabase client
 */
export async function projectRound(
    roundId: string,
    roundKind: 'live' | 'merged',
    // deno-lint-ignore no-explicit-any
    supabase: any,
): Promise<ProjectedRound> {
    let participants: RoundParticipant[] = [];

    if (roundKind === 'live') {
        // ── Live path: table_night_participants ──────────────────────────────
        const { data: rows, error } = await supabase
            .from('table_night_participants')
            .select(`
                user_id,
                rating,
                notes,
                profiles:user_id (
                    display_name,
                    avatar_url
                )
            `)
            .eq('table_night_id', roundId);

        if (error) throw error;

        // deno-lint-ignore no-explicit-any
        participants = (rows ?? []).map((p: any) => {
            const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
            return {
                user_id: p.user_id,
                display_name: profile?.display_name ?? 'User',
                avatar_url: profile?.avatar_url ?? null,
                rating: p.rating ?? null,
                notes: p.notes ?? null,
            };
        });
    } else {
        // ── Merged path: round_entries → entries (profiles batch-fetched) ──────
        // entries has NO foreign key to profiles, so PostgREST 400s on a
        // `profiles:user_id` embed off entries. Fetch the entry authors, then
        // batch-load their profiles separately.
        const { data: bindings, error: bindErr } = await supabase
            .from('round_entries')
            .select(`
                entry_id,
                entries:entry_id (
                    user_id,
                    rating,
                    content
                )
            `)
            .eq('round_id', roundId);

        if (bindErr) throw bindErr;

        // deno-lint-ignore no-explicit-any
        const entryRows = (bindings ?? []).map((b: any) =>
            Array.isArray(b.entries) ? b.entries[0] : b.entries,
        );
        const authorIds = Array.from(
            // deno-lint-ignore no-explicit-any
            new Set(entryRows.filter((e: any) => e?.user_id).map((e: any) => e.user_id as string)),
        );
        // deno-lint-ignore no-explicit-any
        const profileByUserId = new Map<string, any>();
        if (authorIds.length > 0) {
            const { data: profs } = await supabase
                .from('profiles')
                .select('user_id, display_name, avatar_url')
                .in('user_id', authorIds);
            // deno-lint-ignore no-explicit-any
            for (const p of (profs ?? []) as any[]) profileByUserId.set(p.user_id, p);
        }

        // deno-lint-ignore no-explicit-any
        participants = entryRows.map((entry: any) => {
            const profile = entry ? profileByUserId.get(entry.user_id) : null;
            return {
                user_id: entry?.user_id ?? '',
                display_name: profile?.display_name ?? 'User',
                avatar_url: profile?.avatar_url ?? null,
                rating: entry?.rating ?? null,
                notes: entry?.content ?? null,
            };
        });
    }

    const rated = participants.filter((p) => p.rating != null);
    const average_rating =
        rated.length > 0
            ? rated.reduce((sum, p) => sum + (p.rating as number), 0) / rated.length
            : null;

    return {
        round_kind: roundKind,
        participants,
        average_rating,
    };
}
