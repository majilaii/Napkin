/**
 * Calibration helper — TICKET-022
 *
 * Computes Pearson-correlation-based taste calibration between a viewer and
 * one or more target users. Called inline from existing edge functions
 * (user-profile, restaurant-history); never exposed as a standalone endpoint.
 *
 * Privacy contract:
 *  - Viewer's ratings are used server-side regardless of their privacy setting.
 *    Only the aggregate { match_pct, mae, overlap_n } is ever returned — never
 *    per-restaurant breakdowns.
 *  - Target's ratings are filtered to: account_privacy='public' AND
 *    visibility <> 'private'. Silent ratings (no note) DO count; this is
 *    intentionally different from is_entry_publicly_eligible which requires
 *    >= 20 chars. See AC line 162.
 *  - Tablemate-to-Tablemate pairs return null (defense-in-depth). Callers
 *    are responsible for not invoking for Tablemates in the first place.
 *
 * NOTE: If entries.rating scale ever changes from 0–5, MAE_FALLBACK_SCALE
 * must be updated proportionally and the "within D" display copy will need
 * a corresponding adjustment.
 */

// ── Empirical constants — tune after production density is available ───────

/** Minimum shared-restaurant overlap before we show any signal. */
export const OVERLAP_MIN = 5; // empirical-tune-later

/**
 * Shrinkage constant (Bayesian prior strength).
 * At n=OVERLAP_MIN (5), r is multiplied by 5/(5+10) = 0.33.
 * At n=20, ×0.67. At n=50, ×0.83.
 * This makes small-n results read as "honestly uncertain."
 */
export const SHRINKAGE_K = 10; // empirical-tune-later

/**
 * Scale for the MAE fallback: "this many rating points apart = 0% match."
 * At scale=2.0, a user 2 full stars off on every shared restaurant scores 0%.
 * Coupled to the 0–5 rating scale — update if scale changes.
 */
export const MAE_FALLBACK_SCALE = 2.0; // empirical-tune-later

// ── Types ──────────────────────────────────────────────────────────────────

export type Calibration = {
    match_pct: number;    // 0–100, integer (rounded half-up)
    mae: number;          // mean absolute error across overlap, 0–5 scale
    overlap_n: number;    // count of shared rated restaurants
    fallback: boolean;    // true iff Pearson was NULL (stddev=0) and MAE-fallback fired
};

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Batch-compute calibration for (viewer, target[]) pairs.
 *
 * Returns a Map keyed by target_id. Value is Calibration | null.
 * null means: overlap < OVERLAP_MIN, viewer==target, or Tablemates.
 *
 * One SQL round-trip for all targets.
 *
 * CALLER RESPONSIBILITY: do not invoke for Tablemate pairs. This helper
 * defends by returning null for Tablemates, but the caller layer is the
 * primary enforcement point.
 *
 * @param supabase   Service-role client (RLS bypassed; auth validated by caller).
 * @param viewer_id  Authenticated user's id (from supabase.auth.getUser).
 * @param target_ids Array of target user ids (may be empty — returns empty Map).
 * @param opts       Optional overrides for min_overlap threshold.
 */
export async function computeCalibrations(
    supabase: any,
    viewer_id: string,
    target_ids: string[],
    opts?: { min_overlap?: number },
): Promise<Map<string, Calibration | null>> {
    const result = new Map<string, Calibration | null>();

    if (target_ids.length === 0) return result;

    const min_overlap = opts?.min_overlap ?? OVERLAP_MIN;

    // Exclude self from target list
    const filteredTargets = target_ids.filter((id) => id !== viewer_id);

    if (filteredTargets.length === 0) {
        for (const id of target_ids) result.set(id, null);
        return result;
    }

    // ── Defense-in-depth: exclude Tablemates ────────────────────────────────
    // Find all tables the viewer belongs to, then check if any filtered target
    // also belongs to those tables.
    let tablematIds = new Set<string>();
    {
        const { data: viewerMemberships } = await supabase
            .from('table_members')
            .select('table_id')
            .eq('member_id', viewer_id);

        const viewerTableIds = (viewerMemberships ?? []).map((m: any) => m.table_id as string);

        if (viewerTableIds.length > 0) {
            const { data: overlappingMembers } = await supabase
                .from('table_members')
                .select('member_id')
                .in('table_id', viewerTableIds)
                .in('member_id', filteredTargets)
                .neq('member_id', viewer_id);

            for (const m of (overlappingMembers ?? []) as any[]) {
                tablematIds.add(m.member_id as string);
            }
        }
    }

    // Targets that are actually eligible for calibration (non-Tablemates)
    const eligibleTargets = filteredTargets.filter((id) => !tablematIds.has(id));

    // Pre-populate result with null for excluded targets
    for (const id of target_ids) {
        if (id === viewer_id || tablematIds.has(id)) {
            result.set(id, null);
        }
    }

    if (eligibleTargets.length === 0) return result;

    // ── Batch SQL query ─────────────────────────────────────────────────────
    // Viewer's entire rating history (all entries, all privacy levels — viewer-side utility).
    // Target's history filtered to public-account, non-private entries.
    // Joins on restaurant_id to get overlap pairs.
    // Groups by target_id and computes Pearson correlation + MAE.
    //
    // Note: corr() returns NULL when either series has zero variance (stddev=0).
    // That case is handled in Deno (MAE fallback) after we receive the rows.
    const { data: rows, error } = await supabase.rpc('compute_calibration_batch', {
        p_viewer_id: viewer_id,
        p_target_ids: eligibleTargets,
    });

    // If the RPC isn't available yet, fall back to inline SQL via raw query.
    // The RPC approach is preferred for maintainability; the fallback keeps
    // the function working even before the migration is deployed.
    if (error) {
        // Fallback: run the batched CTE directly.
        const batchResult = await runBatchCalibrationSQL(supabase, viewer_id, eligibleTargets);
        for (const [id, cal] of batchResult) {
            result.set(id, cal);
        }
        return result;
    }

    // Process RPC results
    for (const row of (rows ?? []) as any[]) {
        const tid = row.target_id as string;
        const overlapN = row.overlap_n as number;
        const pearsonR = row.pearson_r as number | null;
        const mae = row.mae as number;

        const cal = computeCalibrationFromRow(overlapN, pearsonR, mae, min_overlap);
        result.set(tid, cal);
    }

    // Any eligible target not present in results had 0 overlap → null
    for (const id of eligibleTargets) {
        if (!result.has(id)) {
            result.set(id, null);
        }
    }

    return result;
}

/**
 * Fallback: runs the batched calibration SQL directly as a Postgres query.
 * Used when the compute_calibration_batch RPC is not available.
 */
async function runBatchCalibrationSQL(
    supabase: any,
    viewer_id: string,
    target_ids: string[],
): Promise<Map<string, Calibration | null>> {
    const result = new Map<string, Calibration | null>();

    // We use supabase-js's from() to run the batched join.
    // Since supabase-js doesn't support raw CTEs, we simulate via
    // individual-pair queries for each target — acceptable since target_ids
    // is typically small (1 for profile, up to 20 for restaurant page).
    for (const target_id of target_ids) {
        try {
            // Viewer's rated entries at any restaurant
            const { data: viewerEntries, error: ve } = await supabase
                .from('entries')
                .select('restaurant_id, rating')
                .eq('user_id', viewer_id)
                .not('rating', 'is', null)
                .not('restaurant_id', 'is', null);

            if (ve || !viewerEntries?.length) {
                result.set(target_id, null);
                continue;
            }

            // Target's public rated entries
            const { data: targetEntries, error: te } = await supabase
                .from('entries')
                .select('restaurant_id, rating, profiles!inner(account_privacy)')
                .eq('user_id', target_id)
                .not('rating', 'is', null)
                .not('restaurant_id', 'is', null)
                .neq('visibility', 'private');

            if (te || !targetEntries?.length) {
                result.set(target_id, null);
                continue;
            }

            // Filter target entries to public-account only
            const publicTargetEntries = (targetEntries as any[]).filter(
                (e: any) => {
                    const prof = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles;
                    return prof?.account_privacy === 'public';
                }
            );

            if (!publicTargetEntries.length) {
                result.set(target_id, null);
                continue;
            }

            // Build overlap map
            const viewerMap = new Map<string, number>();
            for (const e of viewerEntries as any[]) {
                viewerMap.set(e.restaurant_id as string, e.rating as number);
            }

            const overlapPairs: { vr: number; tr: number }[] = [];
            for (const e of publicTargetEntries) {
                const rid = e.restaurant_id as string;
                if (viewerMap.has(rid)) {
                    overlapPairs.push({ vr: viewerMap.get(rid)!, tr: e.rating as number });
                }
            }

            if (overlapPairs.length === 0) {
                result.set(target_id, null);
                continue;
            }

            // Compute stats in Deno
            const n = overlapPairs.length;
            const vMean = overlapPairs.reduce((s, p) => s + p.vr, 0) / n;
            const tMean = overlapPairs.reduce((s, p) => s + p.tr, 0) / n;

            let covSum = 0, vVarSum = 0, tVarSum = 0, maeSum = 0;
            for (const { vr, tr } of overlapPairs) {
                const vd = vr - vMean, td = tr - tMean;
                covSum += vd * td;
                vVarSum += vd * vd;
                tVarSum += td * td;
                maeSum += Math.abs(vr - tr);
            }

            const mae = maeSum / n;
            const pearsonR = (vVarSum === 0 || tVarSum === 0)
                ? null
                : covSum / Math.sqrt(vVarSum * tVarSum);

            const cal = computeCalibrationFromRow(n, pearsonR, mae, OVERLAP_MIN);
            result.set(target_id, cal);
        } catch {
            result.set(target_id, null);
        }
    }

    return result;
}

/**
 * Applies shrinkage + match_pct formula + MAE fallback to a raw SQL row.
 * Returns null if overlap_n < min_overlap or math is degenerate.
 */
function computeCalibrationFromRow(
    overlap_n: number,
    pearson_r: number | null,
    mae: number,
    min_overlap: number,
): Calibration | null {
    if (overlap_n < min_overlap) return null;

    let match_pct: number;
    let fallback = false;

    if (pearson_r != null && isFinite(pearson_r)) {
        // Shrinkage: r_adj = r * n / (n + k)
        const r_adj = pearson_r * (overlap_n / (overlap_n + SHRINKAGE_K));
        // Map [-1, 1] → [0, 100]
        match_pct = Math.round(50 * (1 + r_adj));
        // Clamp to [0, 100] in case of floating-point drift
        match_pct = Math.max(0, Math.min(100, match_pct));
    } else {
        // Degenerate case: one user has zero variance on the overlap.
        // Fall back to MAE-based score. Two full rating points off = 0%.
        fallback = true;
        const score = Math.max(0, 1 - mae / MAE_FALLBACK_SCALE);
        match_pct = Math.round(100 * score);
    }

    // Guard NaN / Infinity — hide rather than show garbage
    if (!isFinite(match_pct) || isNaN(match_pct)) return null;

    return {
        match_pct,
        mae: isFinite(mae) ? Math.round(mae * 10) / 10 : 0,
        overlap_n,
        fallback,
    };
}
