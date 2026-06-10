/**
 * TICKET-063b tests — share-to-table from import.
 *
 * Three pure-logic tests (no native RN required):
 *   1. Table-nonce stability: same (candidateKey, tableId) → same nonce across two submits.
 *   2. isResolved eligibility: only spots with restaurant_id OR external_id are eligible.
 *   3. Payload table_id: resolved ticked spots get table_id; ghosts do not.
 */
// Import from the pure-logic utils module (no RN dependency chain).
import { isResolved, keyFor } from '../candidatePickerUtils';
import type { ResolvedCandidate } from '@/hooks/wishlist/useResolveUrl';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<ResolvedCandidate> = {}): ResolvedCandidate {
    return {
        candidate_id: 'cand-1',
        restaurant: {
            id: 'rest-1',
            name: 'Test Restaurant',
            formattedAddress: null,
            city: 'Tokyo',
            country: null,
            latitude: null,
            longitude: null,
            categories: [],
            cuisine: null,
            googleRating: null,
            googleRatingCount: null,
            priceLevel: null,
            photoReference: null,
            website: null,
            link: null,
            external_id: 'gp-id-1',
        },
        confidence: 'high',
        google_place_id: 'gp-id-1',
        restaurant_id: null,
        already_wishlisted: false,
        ...overrides,
    };
}

// Mirrors the `getOrMintTableNonce` closure logic from ImportLinkSheet.tsx.
function makeTableNonceGetter(map: Map<string, string>, generate: () => string) {
    return (c: ResolvedCandidate, tableId: string): string => {
        const mapKey = `${keyFor(c)}:${tableId}`;
        if (!map.has(mapKey)) {
            map.set(mapKey, generate());
        }
        return map.get(mapKey)!;
    };
}

// ── 1. Table-nonce stability ──────────────────────────────────────────────────

describe('table_client_nonce stability across two submits (TICKET-063b AC)', () => {
    it('same (candidateKey, tableId) returns the same nonce on second call', () => {
        const map = new Map<string, string>();
        let count = 0;
        const gen = () => `nonce-${++count}`;
        const getOrMint = makeTableNonceGetter(map, gen);

        const c = makeCandidate({ candidate_id: 'cand-a' });
        const first = getOrMint(c, 'table-x');
        const second = getOrMint(c, 'table-x');

        expect(first).toBe(second);
        expect(count).toBe(1); // generated only once
    });

    it('different tableIds for the same candidate get different nonces', () => {
        const map = new Map<string, string>();
        let count = 0;
        const gen = () => `nonce-${++count}`;
        const getOrMint = makeTableNonceGetter(map, gen);

        const c = makeCandidate({ candidate_id: 'cand-b' });
        const n1 = getOrMint(c, 'table-1');
        const n2 = getOrMint(c, 'table-2');

        expect(n1).not.toBe(n2);
        expect(count).toBe(2);
    });

    it('different candidates for the same tableId get different nonces', () => {
        const map = new Map<string, string>();
        let count = 0;
        const gen = () => `nonce-${++count}`;
        const getOrMint = makeTableNonceGetter(map, gen);

        const c1 = makeCandidate({ candidate_id: 'cand-1' });
        const c2 = makeCandidate({ candidate_id: 'cand-2' });
        const n1 = getOrMint(c1, 'table-x');
        const n2 = getOrMint(c2, 'table-x');

        expect(n1).not.toBe(n2);
        expect(count).toBe(2);
    });

    it('clearing the map and re-calling generates a fresh nonce (new session)', () => {
        const map = new Map<string, string>();
        let count = 0;
        const gen = () => `nonce-${++count}`;
        const getOrMint = makeTableNonceGetter(map, gen);

        const c = makeCandidate({ candidate_id: 'cand-c' });
        const first = getOrMint(c, 'table-x');
        map.clear(); // simulates handleDismiss / handleFindIt
        const second = getOrMint(c, 'table-x');

        expect(first).not.toBe(second);
        expect(count).toBe(2);
    });
});

// ── 2. isResolved eligibility ────────────────────────────────────────────────

describe('isResolved — Places-resolved eligibility for table fan-out (TICKET-063b AC)', () => {
    it('returns true when restaurant_id is set (already in DB)', () => {
        const c = makeCandidate({ restaurant_id: 'db-id-123' });
        expect(isResolved(c)).toBe(true);
    });

    it('returns true when restaurant.external_id is set (Places identity, ghost)', () => {
        const c = makeCandidate({ restaurant_id: null });
        // external_id already set in makeCandidate default ('gp-id-1')
        expect(isResolved(c)).toBe(true);
    });

    it('returns false when both restaurant_id and external_id are null/empty (unresolved ghost)', () => {
        const c = makeCandidate({
            restaurant_id: null,
            restaurant: {
                ...makeCandidate().restaurant,
                external_id: null,
            },
        });
        expect(isResolved(c)).toBe(false);
    });

    it('returns false when external_id is empty string', () => {
        const c = makeCandidate({
            restaurant_id: null,
            restaurant: {
                ...makeCandidate().restaurant,
                external_id: '',
            },
        });
        expect(isResolved(c)).toBe(false);
    });
});

// ── 3. Payload: table_id only for resolved ticked spots ──────────────────────

describe('spot payload table_id gating: resolved get table_id, ghosts do not (TICKET-063b AC)', () => {
    it('resolved spot gets table_id and table_client_nonce when chosenTable is set', () => {
        const map = new Map<string, string>();
        let count = 0;
        const getOrMint = makeTableNonceGetter(map, () => `n-${++count}`);

        const chosenTable = { id: 'tbl-1', name: 'The Usual' };
        const resolved = makeCandidate({ candidate_id: 'res-1', restaurant_id: 'db-1' });

        const tableId = (chosenTable && isResolved(resolved)) ? chosenTable.id : null;
        const tableNonce = (chosenTable && isResolved(resolved))
            ? getOrMint(resolved, chosenTable.id)
            : null;

        expect(tableId).toBe('tbl-1');
        expect(tableNonce).not.toBeNull();
    });

    it('ghost spot gets null table_id even when chosenTable is set', () => {
        const chosenTable = { id: 'tbl-1', name: 'The Usual' };
        const ghost = makeCandidate({
            candidate_id: 'ghost-1',
            restaurant_id: null,
            restaurant: {
                ...makeCandidate().restaurant,
                external_id: null,
            },
        });

        const tableId = (chosenTable && isResolved(ghost)) ? chosenTable.id : null;
        expect(tableId).toBeNull();
    });

    it('mixed batch: resolved gets table_id, ghost does not', () => {
        const map = new Map<string, string>();
        let count = 0;
        const getOrMint = makeTableNonceGetter(map, () => `n-${++count}`);

        const chosenTable = { id: 'tbl-1', name: 'The Usual' };
        const resolved = makeCandidate({ candidate_id: 'res-1', restaurant_id: 'db-1' });
        const ghost = makeCandidate({
            candidate_id: 'ghost-1',
            restaurant_id: null,
            restaurant: { ...makeCandidate().restaurant, external_id: null },
        });

        const build = (c: ResolvedCandidate) => ({
            candidate_id: c.candidate_id,
            table_id: (chosenTable && isResolved(c)) ? chosenTable.id : null,
            table_client_nonce: (chosenTable && isResolved(c))
                ? getOrMint(c, chosenTable.id)
                : null,
        });

        const resolvedPayload = build(resolved);
        const ghostPayload = build(ghost);

        expect(resolvedPayload.table_id).toBe('tbl-1');
        expect(resolvedPayload.table_client_nonce).not.toBeNull();
        expect(ghostPayload.table_id).toBeNull();
        expect(ghostPayload.table_client_nonce).toBeNull();
    });

    it('no chosenTable → all spots get null table_id regardless of resolution', () => {
        const chosenTable = null;
        const resolved = makeCandidate({ restaurant_id: 'db-1' });

        const tableId = (chosenTable && isResolved(resolved)) ? (chosenTable as any).id : null;
        expect(tableId).toBeNull();
    });
});
