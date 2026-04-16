/**
 * Member Profile Edge Function
 *
 * Returns a Table-scoped member profile: display info, stats,
 * top-5 highest-rated entries, and recent activity (entries + round participations).
 *
 * Authorization:
 *   - Caller must be a current member of the table.
 *   - Target user must be a current OR former member of the table
 *     (presence in entries OR table_night_participants for that table_id).
 *   - If target has no presence → 403.
 *
 * Actions:
 *   GET ?action=profile&user_id=X&table_id=Y
 *
 * Response: { data: { profile, is_current_member, stats, top_entries, recent_activity } }
 * Private entries (visibility = 'private') are excluded from all lists and stats.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

// ── Types ──────────────────────────────────────────────────────────────────

type MemberProfile = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    joined_at: string | null; // null for former members not in table_members
};

type MemberStats = {
    avg: number | null;
    entry_count: number;
    round_count: number;
    std_dev: number | null;
};

type TopEntry = {
    id: string;
    restaurant_name: string;
    rating: number;
    visited_at: string;
};

type RecentActivityItem = {
    kind: 'entry' | 'round';
    id: string; // entry_id or table_night_id
    restaurant_name: string;
    rating: number | null;
    date: string; // ISO
};

// ── Helpers ────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function fail(message: string, status = 400): Response {
    return json({ error: message }, status);
}

// ── Main ───────────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!authHeader) return fail('Missing Authorization header', 401);

        const token = authHeader.replace('Bearer ', '');
        const supabase = createClient(supabaseUrl ?? '', supabaseServiceKey ?? '');

        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser(token);
        if (userError || !user) return fail('Unauthorized', 401);

        const url = new URL(req.url);
        const action = url.searchParams.get('action');

        if (req.method !== 'GET') return fail('Method not allowed', 405);
        if (action !== 'profile') return fail('Unknown action', 400);

        const targetUserId = url.searchParams.get('user_id');
        const tableId = url.searchParams.get('table_id');

        if (!targetUserId) return fail('user_id is required', 400);
        if (!tableId) return fail('table_id is required', 400);

        // ── 1. Verify caller is a current member ──────────────────────────
        const { data: callerMembership, error: callerErr } = await supabase
            .from('table_members')
            .select('member_id')
            .eq('table_id', tableId)
            .eq('member_id', user.id)
            .maybeSingle();
        if (callerErr) throw callerErr;
        if (!callerMembership) return fail('This profile isn\'t available.', 403);

        // ── 2. Check target's current membership ──────────────────────────
        const { data: targetMembership, error: targetMemberErr } = await supabase
            .from('table_members')
            .select('member_id, joined_at')
            .eq('table_id', tableId)
            .eq('member_id', targetUserId)
            .maybeSingle();
        if (targetMemberErr) throw targetMemberErr;

        const isCurrentMember = !!targetMembership;

        // ── 3. Verify target has historical presence (if not current member)
        if (!isCurrentMember) {
            // Check entries in this table
            const { data: entryPresence } = await supabase
                .from('entries')
                .select('id')
                .eq('table_id', tableId)
                .eq('user_id', targetUserId)
                .limit(1)
                .maybeSingle();

            if (!entryPresence) {
                // Check round participations via table_nights join
                const { data: roundPresence } = await supabase
                    .from('table_nights')
                    .select(`
                        id,
                        table_night_participants!inner(user_id)
                    `)
                    .eq('table_id', tableId)
                    .eq('table_night_participants.user_id', targetUserId)
                    .limit(1)
                    .maybeSingle();

                if (!roundPresence) {
                    return fail('This profile isn\'t available.', 403);
                }
            }
        }

        // ── 4. Fetch target profile ────────────────────────────────────────
        const { data: profileRow, error: profileErr } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('user_id', targetUserId)
            .maybeSingle();
        if (profileErr) throw profileErr;

        const profile: MemberProfile = {
            user_id: targetUserId,
            display_name: profileRow?.display_name ?? 'Unknown',
            avatar_url: null,
            joined_at: targetMembership?.joined_at ?? null,
        };

        // ── 5. Stats — from non-private SOLO entries in this table ────────
        // Exclude round-associated entries: `table-activity` uses the same filter,
        // and the "Entries" stat / Top 5 mean solo shares, not round contributions.
        const { data: entryRows, error: entryStatsErr } = await supabase
            .from('entries')
            .select('id, rating, visited_at, created_at, restaurant_id, restaurants(name)')
            .eq('user_id', targetUserId)
            .eq('table_id', tableId)
            .is('table_night_id', null)
            .neq('visibility', 'private')
            .order('rating', { ascending: false })
            .order('visited_at', { ascending: false });
        if (entryStatsErr) throw entryStatsErr;

        const allEntries = (entryRows ?? []) as Array<{
            id: string;
            rating: number | null;
            visited_at: string | null;
            created_at: string;
            restaurant_id: string | null;
            restaurants: { name: string } | { name: string }[] | null;
        }>;

        // Only count entries with a rating for avg/stddev
        const ratedEntries = allEntries.filter((e) => e.rating != null);
        const entryCount = allEntries.length;
        const avg =
            ratedEntries.length > 0
                ? ratedEntries.reduce((sum, e) => sum + (e.rating as number), 0) / ratedEntries.length
                : null;

        // Standard deviation over rated entries
        let stdDev: number | null = null;
        if (ratedEntries.length >= 2 && avg != null) {
            const variance =
                ratedEntries.reduce((sum, e) => sum + Math.pow((e.rating as number) - avg, 2), 0) /
                ratedEntries.length;
            stdDev = Math.sqrt(variance);
        }

        // Round count — table_night_participants joined to table_nights in this table
        const { data: roundRows, error: roundCountErr } = await supabase
            .from('table_nights')
            .select(`
                id,
                revealed_at,
                created_at,
                restaurant_id,
                restaurants(name),
                table_night_participants!inner(user_id, rating)
            `)
            .eq('table_id', tableId)
            .eq('table_night_participants.user_id', targetUserId)
            .in('status', ['revealed', 'closed']);
        if (roundCountErr) throw roundCountErr;

        const rounds = (roundRows ?? []) as Array<{
            id: string;
            revealed_at: string | null;
            created_at: string;
            restaurant_id: string | null;
            restaurants: { name: string } | { name: string }[] | null;
            table_night_participants: Array<{ user_id: string; rating: number | null }>;
        }>;

        const roundCount = rounds.length;

        const stats: MemberStats = {
            avg,
            entry_count: entryCount,
            round_count: roundCount,
            std_dev: stdDev,
        };

        // ── 6. Top 5 entries — already sorted by (rating DESC, visited_at DESC)
        const top5 = allEntries
            .filter((e) => e.rating != null)
            .slice(0, 5)
            .map((e): TopEntry => {
                const restaurantData = e.restaurants;
                const restaurantName = Array.isArray(restaurantData)
                    ? restaurantData[0]?.name ?? 'Unknown spot'
                    : restaurantData?.name ?? 'Unknown spot';
                return {
                    id: e.id,
                    restaurant_name: restaurantName,
                    rating: e.rating as number,
                    visited_at: e.visited_at ?? e.created_at,
                };
            });

        // ── 7. Recent activity — merge solo entries + round participations ─
        // Solo entries only: round-associated entries surface via the round row.
        const { data: recentEntryRows, error: recentEntryErr } = await supabase
            .from('entries')
            .select('id, rating, visited_at, created_at, restaurants(name)')
            .eq('user_id', targetUserId)
            .eq('table_id', tableId)
            .is('table_night_id', null)
            .neq('visibility', 'private')
            .order('visited_at', { ascending: false })
            .limit(10);
        if (recentEntryErr) throw recentEntryErr;

        const recentEntries = (recentEntryRows ?? []) as Array<{
            id: string;
            rating: number | null;
            visited_at: string | null;
            created_at: string;
            restaurants: { name: string } | { name: string }[] | null;
        }>;

        const entryActivity: RecentActivityItem[] = recentEntries.map((e) => {
            const restaurantData = e.restaurants;
            const restaurantName = Array.isArray(restaurantData)
                ? restaurantData[0]?.name ?? 'Unknown spot'
                : restaurantData?.name ?? 'Unknown spot';
            return {
                kind: 'entry' as const,
                id: e.id,
                restaurant_name: restaurantName,
                rating: e.rating,
                date: e.visited_at ?? e.created_at,
            };
        });

        // Rounds for recent activity (already fetched above, take up to 10)
        const roundActivity: RecentActivityItem[] = rounds
            .slice(0, 10)
            .map((r): RecentActivityItem => {
                const restaurantData = r.restaurants;
                const restaurantName = Array.isArray(restaurantData)
                    ? restaurantData[0]?.name ?? 'Unknown spot'
                    : restaurantData?.name ?? 'Unknown spot';
                // Find this user's rating for the round
                const myParticipation = r.table_night_participants.find(
                    (p) => p.user_id === targetUserId,
                );
                return {
                    kind: 'round' as const,
                    id: r.id,
                    restaurant_name: restaurantName,
                    rating: myParticipation?.rating ?? null,
                    date: r.revealed_at ?? r.created_at,
                };
            });

        // Merge, sort by date desc, slice to 10
        const recentActivity = [...entryActivity, ...roundActivity]
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
            .slice(0, 10);

        return json({
            data: {
                profile,
                is_current_member: isCurrentMember,
                stats,
                top_entries: top5,
                recent_activity: recentActivity,
            },
        });
    } catch (err) {
        const details = err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null
                ? JSON.stringify(err)
                : String(err);
        console.error('member-profile error:', details);
        return json({ error: 'Internal Server Error', details }, 500);
    }
});
