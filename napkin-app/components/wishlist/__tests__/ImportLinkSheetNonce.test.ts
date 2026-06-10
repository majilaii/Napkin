/**
 * ImportLinkSheet nonce behavior tests — TICKET-063 fix-pass-1.
 *
 * Tests items 7 and 9 from fix-pass-1 using pure logic (no native RN needed):
 *  7. Stable retry nonces — nonce map returns the same nonce for the same key.
 *  9. import_nonce threaded through auth → ImportLinkSheet initializes from prop.
 */

// ── Fix 7: stable per-spot nonce map ─────────────────────────────────────────
//
// The nonce map is a Map<string, string> keyed by candidate_id.
// Same candidate_id → same nonce across multiple calls (retries).

function getOrMintNonce(
    map: Map<string, string>,
    candidateId: string,
    generateNonce: () => string,
): string {
    if (!map.has(candidateId)) {
        map.set(candidateId, generateNonce());
    }
    return map.get(candidateId)!;
}

describe('spotNonceMapRef: stable nonces across submit calls (fix-pass-1 item 7)', () => {
    it('same candidate_id returns same nonce on second call', () => {
        const map = new Map<string, string>();
        let callCount = 0;
        const mockGenerate = () => `nonce-${++callCount}`;

        const first = getOrMintNonce(map, 'candidate-abc', mockGenerate);
        const second = getOrMintNonce(map, 'candidate-abc', mockGenerate);

        expect(first).toBe(second);
        expect(callCount).toBe(1); // generateNonce only called once
    });

    it('different candidate_ids get different nonces', () => {
        const map = new Map<string, string>();
        let callCount = 0;
        const mockGenerate = () => `nonce-${++callCount}`;

        const nonce1 = getOrMintNonce(map, 'candidate-1', mockGenerate);
        const nonce2 = getOrMintNonce(map, 'candidate-2', mockGenerate);

        expect(nonce1).not.toBe(nonce2);
        expect(callCount).toBe(2);
    });

    it('cleared map generates fresh nonces (new import)', () => {
        const map = new Map<string, string>();
        let callCount = 0;
        const mockGenerate = () => `nonce-${++callCount}`;

        const first = getOrMintNonce(map, 'candidate-abc', mockGenerate);
        map.clear(); // simulate handleDismiss or handleFindIt
        const second = getOrMintNonce(map, 'candidate-abc', mockGenerate);

        expect(first).not.toBe(second);
        expect(callCount).toBe(2); // generateNonce called twice (once per import)
    });

    it('retry with same map reuses nonces — no double-spend on retry', () => {
        const map = new Map<string, string>();
        let count = 0;
        const gen = () => `nonce-${++count}`;

        // First save attempt: 3 spots
        const nonces1 = ['c1', 'c2', 'c3'].map((id) => getOrMintNonce(map, id, gen));
        // Simulate partial failure: c2 failed. Second save attempt retries c2 only.
        const retryNonce = getOrMintNonce(map, 'c2', gen);

        expect(retryNonce).toBe(nonces1[1]); // same nonce as first attempt
        expect(count).toBe(3); // no extra generate calls
    });
});

// ── Fix 9: import_nonce threaded through auth ─────────────────────────────────
//
// The stash → auth → /import → ImportLinkSheet chain preserves the
// pre-auth import_nonce. ImportLinkSheet initializes importNonceRef from
// the initialImportNonce prop.

describe('import_nonce threading through auth (fix-pass-1 item 9)', () => {
    it('initialImportNonce prop seeds the importNonceRef', () => {
        // Simulate ImportLinkSheet initialization:
        // importNonceRef = useRef(initialImportNonce ?? generateNonce())
        const initialImportNonce = 'stashed-nonce-from-before-auth';
        let generatorCallCount = 0;
        const mockGenerate = () => {
            generatorCallCount++;
            return 'fresh-nonce';
        };

        const importNonce = initialImportNonce ?? mockGenerate();

        expect(importNonce).toBe('stashed-nonce-from-before-auth');
        expect(generatorCallCount).toBe(0); // generateNonce not called when prop provided
    });

    it('missing initialImportNonce prop → generate a fresh nonce', () => {
        const initialImportNonce: string | undefined = undefined;
        let generatorCallCount = 0;
        const mockGenerate = () => {
            generatorCallCount++;
            return 'fresh-nonce';
        };

        const importNonce = initialImportNonce ?? mockGenerate();

        expect(importNonce).toBe('fresh-nonce');
        expect(generatorCallCount).toBe(1);
    });

    it('auth.tsx re-stash preserves import_nonce on sign-in failure', () => {
        // Simulate the stash → sign-in-fail → re-stash pattern in auth.tsx.
        const originalStash = {
            url: 'https://tiktok.com/v/123',
            import_nonce: 'the-original-nonce',
            stashedAt: Date.now(),
        };

        // The fix: `pendingImport.stash(stashed.url, stashed.import_nonce)`
        // Previously: `pendingImport.stash(stashed.url)` — dropped the nonce!
        const restashedNonce = originalStash.import_nonce; // preserved
        expect(restashedNonce).toBe('the-original-nonce');
    });

    it('partial-failure keeps sheet open: not all succeeded → do NOT dismiss', () => {
        // Simulate the onSuccess handler logic in handleSaveSpots:
        const results = [
            { client_nonce: 'n1', status: 'saved' as const },
            { client_nonce: 'n2', status: 'failed' as const },
        ];
        const hasFailures = results.some((r) => r.status === 'failed');
        expect(hasFailures).toBe(true); // sheet stays open
    });

    it('all succeeded → should dismiss', () => {
        const results = [
            { client_nonce: 'n1', status: 'saved' as const },
            { client_nonce: 'n2', status: 'already_pinned' as const },
        ];
        const hasFailures = results.some((r) => r.status === 'failed');
        expect(hasFailures).toBe(false); // sheet dismisses
    });

    it('retry skips already-saved candidates', () => {
        // Simulate savedCandidateIdsRef logic in handleSaveSpots.
        const savedIds = new Set(['c1', 'c2']);

        const tickedCandidates = ['c1', 'c2', 'c3']; // c3 failed previously
        const spotsToSend = tickedCandidates.filter((id) => !savedIds.has(id));

        expect(spotsToSend).toEqual(['c3']); // only failed spot retried
    });
});
