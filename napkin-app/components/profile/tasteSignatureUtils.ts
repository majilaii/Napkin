import { HISTOGRAM_BINS } from './tasteUtils';

export function formatHalfRating(value: number): string {
    const whole = Math.floor(value);
    const half = value % 1 !== 0;
    if (whole === 0 && half) return '½';
    return half ? `${whole}½` : `${whole}`;
}

/** Middle 60% band: a compact, factual translation of the overall histogram. */
export function ratingBandSummary(counts: number[]): string | null {
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (total < 3) return null;

    const valueAt = (quantile: number) => {
        const target = Math.max(1, Math.ceil(total * quantile));
        let cumulative = 0;
        for (let index = 0; index < HISTOGRAM_BINS.length; index += 1) {
            cumulative += counts[index] ?? 0;
            if (cumulative >= target) return HISTOGRAM_BINS[index];
        }
        return HISTOGRAM_BINS[HISTOGRAM_BINS.length - 1];
    };

    const low = valueAt(0.2);
    const high = valueAt(0.8);
    return low === high
        ? `most marks land at ${formatHalfRating(low)}`
        : `most marks land between ${formatHalfRating(low)} and ${formatHalfRating(high)}`;
}
