/**
 * stats.ts — pure palate-shape derivations for the profile stats payload.
 *
 * Extracted from index.ts (TICKET-165) so the binning semantics are executable
 * as unit tests without importing the serve() entrypoint — index.ts calls
 * serve() at the top level and is NOT import-safe. Mirrors the gates.ts
 * "extracted so the semantics are executable" pattern.
 *
 * `fetchStats` calls these over the SAME `entries` rows it already fetched (the
 * ones that passed the `includePrivate` audience gate), so the histogram and the
 * dimension means inherit that gate for free — public viewers never see a
 * private entry counted here.
 */

/** One half-star histogram bucket — r is the snapped rating (0.5 … 5.0). */
export interface HistogramBucket {
    r: number;
    n: number;
}

/** Per-dimension mean + sample size (null avg ⇒ no non-null values). */
export interface DimensionStat {
    avg: number | null;
    n: number;
}

export interface DimensionAvgs {
    vibe: DimensionStat;
    flavor: DimensionStat;
    service: DimensionStat;
    value: DimensionStat;
}

/**
 * Sparse half-star histogram over the rated ratings. Each rating is snapped to
 * the nearest half-star (`Math.round(r * 2) / 2`) and clamped to [0.5, 5.0] —
 * the same grid the client's `fillHistogram` / `HISTOGRAM_BINS` expect. Nulls
 * are dropped. Output is sorted ascending by `r` (deterministic for tests + a
 * clean wire shape); empty buckets are omitted (sparse).
 */
export function computeRatingHistogram(
    ratings: Array<number | null | undefined>,
): HistogramBucket[] {
    const counts = new Map<number, number>();
    for (const raw of ratings) {
        if (raw == null || !Number.isFinite(raw)) continue;
        const snapped = Math.min(5, Math.max(0.5, Math.round(raw * 2) / 2));
        counts.set(snapped, (counts.get(snapped) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([r, n]) => ({ r, n }));
}

/**
 * Per-dimension mean + count over the sub-ratings. Each dimension is nullable
 * (composer writes null when a dial is untouched / zeroed), so each mean is
 * taken over only its own non-null values — a sparse dimension yields a small
 * `n` the client uses to omit thin spines (n < 3).
 */
export function computeDimensionAvgs(
    rows: Array<{
        vibe_rating?: number | null;
        flavor_rating?: number | null;
        service_rating?: number | null;
        value_rating?: number | null;
    }>,
): DimensionAvgs {
    const dim = (pick: (r: (typeof rows)[number]) => number | null | undefined): DimensionStat => {
        let sum = 0;
        let n = 0;
        for (const r of rows) {
            const v = pick(r);
            if (v == null || !Number.isFinite(v)) continue;
            sum += v;
            n += 1;
        }
        return { avg: n > 0 ? sum / n : null, n };
    };
    return {
        vibe: dim((r) => r.vibe_rating),
        flavor: dim((r) => r.flavor_rating),
        service: dim((r) => r.service_rating),
        value: dim((r) => r.value_rating),
    };
}
