/**
 * tasteUtils — pure client-side derivations for the taste drill-in (TICKET-112).
 *
 * Extracted so the editorial-line gate can be unit-tested without importing the
 * screen (no React / native). No I/O, no React, no native imports.
 */
import type { TasteData, CategoryStat } from '@/hooks/users/useUserTaste';

/** The four axes, in display order. "flavor" is the founder's "taste". */
export const TASTE_AXES: { key: keyof TasteData['categories']; label: string }[] = [
    { key: 'flavor', label: 'Taste' },
    { key: 'service', label: 'Service' },
    { key: 'value', label: 'Value' },
    { key: 'vibe', label: 'Vibe' },
];

/**
 * "you rate {axis} the hardest" — the lowest-mean axis label, but ONLY when the
 * signal is real: spread (max − min mean) ≥ 0.4 AND every axis has n ≥ 5. Thin
 * or flat data → null (no editorial line). Returns the display label (e.g.
 * "Value"), or null.
 */
export function deriveHardestAxis(cats: TasteData['categories']): string | null {
    const scored = TASTE_AXES
        .map((a) => ({ label: a.label, stat: cats[a.key] }))
        .filter((x): x is { label: string; stat: CategoryStat & { avg: number } } => x.stat.avg != null);
    if (scored.length < 2) return null;
    // Every axis must be well-sampled — thin data never fires the line.
    if (TASTE_AXES.some((a) => cats[a.key].n < 5)) return null;
    const avgs = scored.map((s) => s.stat.avg);
    const spread = Math.max(...avgs) - Math.min(...avgs);
    if (spread < 0.4) return null;
    const hardest = scored.reduce((lo, s) => (s.stat.avg < lo.stat.avg ? s : lo), scored[0]);
    return hardest.label;
}
