/**
 * tasteUtils unit tests — TICKET-112 editorial-line gate.
 *
 * "you rate {axis} the hardest" fires ONLY when the signal is real:
 *   spread (max − min mean) >= 0.4 AND every axis n >= 5.
 * Thin or flat data → null (no line).
 */
import { deriveHardestAxis } from '../tasteUtils';
import type { TasteData } from '@/hooks/users/useUserTaste';

function cats(over: Partial<Record<keyof TasteData['categories'], { avg: number | null; n: number }>> = {}): TasteData['categories'] {
    const base = { avg: 4.0, n: 10 };
    return {
        flavor: { ...base, ...over.flavor },
        service: { ...base, ...over.service },
        value: { ...base, ...over.value },
        vibe: { ...base, ...over.vibe },
    };
}

describe('deriveHardestAxis', () => {
    it('returns the lowest-mean axis when spread >= 0.4 and all n >= 5', () => {
        const c = cats({
            flavor: { avg: 4.6, n: 8 },
            service: { avg: 4.2, n: 7 },
            value: { avg: 3.9, n: 6 },   // lowest → "Value"
            vibe: { avg: 4.4, n: 5 },
        });
        expect(deriveHardestAxis(c)).toBe('Value');
    });

    it('returns null when spread < 0.4 (flat data)', () => {
        const c = cats({
            flavor: { avg: 4.1, n: 10 },
            service: { avg: 4.0, n: 10 },
            value: { avg: 4.0, n: 10 },
            vibe: { avg: 4.2, n: 10 }, // spread 0.2 < 0.4
        });
        expect(deriveHardestAxis(c)).toBeNull();
    });

    it('returns null when ANY axis has n < 5 (thin data)', () => {
        const c = cats({
            flavor: { avg: 4.8, n: 10 },
            service: { avg: 4.0, n: 10 },
            value: { avg: 3.5, n: 4 },  // n < 5 → suppress the line entirely
            vibe: { avg: 4.4, n: 10 },
        });
        expect(deriveHardestAxis(c)).toBeNull();
    });

    it('returns null when fewer than two axes have a mean', () => {
        const c = cats({
            flavor: { avg: 4.0, n: 10 },
            service: { avg: null, n: 0 },
            value: { avg: null, n: 0 },
            vibe: { avg: null, n: 0 },
        });
        expect(deriveHardestAxis(c)).toBeNull();
    });

    it('taste (flavor) can itself be the hardest axis', () => {
        const c = cats({
            flavor: { avg: 3.4, n: 12 }, // lowest → "Taste"
            service: { avg: 4.5, n: 8 },
            value: { avg: 4.2, n: 6 },
            vibe: { avg: 4.6, n: 9 },
        });
        expect(deriveHardestAxis(c)).toBe('Taste');
    });
});
