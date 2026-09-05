/**
 * resolvespots.test.ts — TICKET-152 Phase A unit tests.
 *
 * Tests the pure DECISION helpers for the large-maps-list import path:
 *   resolve_spots arg validation, the pin_wishlist branch (RPC vs upsert-only /
 *   verified vs ghost), and the RESOLVE_SPOTS_GHOST_ONLY kill-switch gate.
 *
 * No live DB / network — the network-touching resolve core stays in index.ts and
 * is exercised by smoke, not here (mirrors savespots.test.ts's scope).
 */

import {
    assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    validateResolveSpotsArgs,
    normalizePinWishlist,
    listOnlySaveKind,
    isGhostOnlyMode,
    IMPORT_PLACE_TYPE_ALLOWLIST,
    hasAllowedImportPlaceType,
    resolveImportPlaceSearch,
    shouldEmitGhostCandidate,
    buildUnattemptedResolveSpotResult,
    buildResolveSpotDecisionResult,
    attemptedExternalIdFromResolutionEvidence,
    isV2ResolveSpotsProtocol,
    placesFailureDecision,
    resolveSpotsRateGate,
    resolutionDecisionForCandidate,
    buildPlacesSearchBody,
    keepTypeRejectedAsGhost,
} from './_helpers.ts';
import { mapsItemsToStaged } from './mapsList.ts';

Deno.test('import Places request keeps name bare and forwards structured locality', () => {
    const body = buildPlacesSearchBody('Parisik', {
        city: 'Paris',
        area: 'Le Marais',
    });
    assertEquals(body, {
        query: 'Parisik',
        limit: 3,
        city: 'Paris',
        area: 'Le Marais',
    });
});

// ── 1. validateResolveSpotsArgs — the paid-amplifier arg gates (L3) ───────────
//
// Arg validation runs BEFORE the rate check and any Places call, so a malformed
// request 400s deterministically (the empty-items smoke depends on this) and
// never burns an import_spots token.

Deno.test('validateResolveSpotsArgs: empty items → reject (the smoke case)', () => {
    const r = validateResolveSpotsArgs('smoke', []);
    assertEquals(r.ok, false, 'empty items must be rejected → 400 INVALID_BODY');
});

Deno.test('validateResolveSpotsArgs: > 20 items → reject (hard cap, paid amplifier)', () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
        name: `Spot ${i}`, address: `${i} Main St`, client_nonce: `n${i}`,
    }));
    const r = validateResolveSpotsArgs('nonce', items);
    assertEquals(r.ok, false, '21 items must be rejected (cap is 20)');
});

Deno.test('validateResolveSpotsArgs: exactly 20 items → ok (cap boundary)', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
        name: `Spot ${i}`, address: `${i} Main St`, client_nonce: `n${i}`,
    }));
    const r = validateResolveSpotsArgs('nonce', items);
    assertEquals(r.ok, true, '20 items is the inclusive upper bound');
    if (r.ok) assertEquals(r.items.length, 20);
});

Deno.test('validateResolveSpotsArgs: missing/empty import_nonce → reject', () => {
    const items = [{ name: 'Carbone', address: '181 Thompson St', client_nonce: 'n1' }];
    assertEquals(validateResolveSpotsArgs(undefined, items).ok, false, 'missing nonce rejected');
    assertEquals(validateResolveSpotsArgs('', items).ok, false, 'empty nonce rejected');
    assertEquals(validateResolveSpotsArgs('   ', items).ok, false, 'whitespace nonce rejected');
    assertEquals(validateResolveSpotsArgs(42, items).ok, false, 'non-string nonce rejected');
});

Deno.test('validateResolveSpotsArgs: item missing name or client_nonce → reject', () => {
    assertEquals(
        validateResolveSpotsArgs('nonce', [{ address: 'x', client_nonce: 'n1' }]).ok,
        false, 'an item without a name is rejected (name is the Places query seed)',
    );
    assertEquals(
        validateResolveSpotsArgs('nonce', [{ name: 'Carbone', address: 'x' }]).ok,
        false, 'an item without a client_nonce is rejected (it is the echo-join key)',
    );
});

Deno.test('validateResolveSpotsArgs: happy path normalizes (address absent → null, trims)', () => {
    const r = validateResolveSpotsArgs('  job-nonce  ', [
        { name: '  Carbone  ', address: '  181 Thompson St  ', client_nonce: '  n1  ' },
        { name: 'Ghost Diner', client_nonce: 'n2' }, // no address
    ]);
    assertEquals(r.ok, true);
    if (r.ok) {
        assertEquals(r.items[0], { name: 'Carbone', address: '181 Thompson St', client_nonce: 'n1' });
        assertEquals(r.items[1], { name: 'Ghost Diner', address: null, client_nonce: 'n2' });
    }
});

Deno.test('validateResolveSpotsArgs: normalized items stage 1:1 by index (echo-join alignment)', () => {
    // The client maps result→item by client_nonce; the server aligns results to
    // input by index (mapsItemsToStaged preserves order + caps at 20). This asserts
    // the staged array is index-aligned so results[i] ↔ items[i].client_nonce holds.
    const r = validateResolveSpotsArgs('nonce', [
        { name: 'A', address: '1 St', client_nonce: 'na' },
        { name: 'B', address: '2 St', client_nonce: 'nb' },
        { name: 'C', address: '3 St', client_nonce: 'nc' },
    ]);
    assertEquals(r.ok, true);
    if (!r.ok) return;
    const staged = mapsItemsToStaged(r.items.map((i) => ({ name: i.name, address: i.address })), 20);
    assertEquals(staged.length, r.items.length, 'staging preserves count (no drop under cap)');
    staged.forEach((s, i) => {
        assertEquals(s.extracted.name, r.items[i].name, `staged[${i}] must align with items[${i}]`);
        assertEquals(s.ordinal, i, 'ordinal must be the input index (join alignment)');
    });
});

// ── 2. normalizePinWishlist — default-true / explicit-false-only ──────────────
//
// Only a real boolean `false` turns pinning off; every legacy caller omits the
// field → true → today's wishlist-pin behavior byte-for-byte.

Deno.test('normalizePinWishlist: absent (undefined) → true (back-compat default)', () => {
    assertEquals(normalizePinWishlist(undefined), true);
});

Deno.test('normalizePinWishlist: explicit true → true', () => {
    assertEquals(normalizePinWishlist(true), true);
});

Deno.test('normalizePinWishlist: explicit false → false (list-only import)', () => {
    assertEquals(normalizePinWishlist(false), false);
});

Deno.test('normalizePinWishlist: non-boolean truthy/falsy → true (only literal false disables)', () => {
    assertEquals(normalizePinWishlist('false'), true, 'a string "false" must NOT disable pinning');
    assertEquals(normalizePinWishlist(0), true);
    assertEquals(normalizePinWishlist(null), true);
    assertEquals(normalizePinWishlist(1), true);
});

// ── 3. listOnlySaveKind — pin_wishlist=false branch (upsert-only vs ghost) ────
//
// M1: a list-only spot never touches fn_save_import_spot. It either reuses a
// restaurant_id in hand, upserts a verified row from a real external_id, or mints
// a deterministic unverified ghost (so a list-only job never silently drops a spot
// and lazy verify-on-open still repairs it).

Deno.test('listOnlySaveKind: restaurant_id in hand → existing (status saved)', () => {
    assertEquals(listOnlySaveKind('rid-1', 'ChIJabc'), 'existing');
    assertEquals(listOnlySaveKind('rid-1', null), 'existing', 'restaurant_id wins even without external_id');
});

Deno.test('listOnlySaveKind: real external_id, no restaurant_id → verified (upsert verified)', () => {
    assertEquals(listOnlySaveKind(null, 'ChIJabc'), 'verified');
    assertEquals(listOnlySaveKind(undefined, 'ChIJabc'), 'verified');
});

Deno.test('listOnlySaveKind: no external_id at all → ghost (mint unverified deterministic row)', () => {
    assertEquals(listOnlySaveKind(null, null), 'ghost');
    assertEquals(listOnlySaveKind(undefined, undefined), 'ghost');
    assertEquals(listOnlySaveKind(null, ''), 'ghost', 'empty external_id is not resolvable');
});

// ── 4. isGhostOnlyMode — kill-switch env gate ────────────────────────────────

Deno.test('isGhostOnlyMode: unset / empty / falsy strings → off', () => {
    assertEquals(isGhostOnlyMode(undefined), false);
    assertEquals(isGhostOnlyMode(null), false);
    assertEquals(isGhostOnlyMode(''), false);
    assertEquals(isGhostOnlyMode('0'), false);
    assertEquals(isGhostOnlyMode('false'), false);
    assertEquals(isGhostOnlyMode('off'), false);
    assertEquals(isGhostOnlyMode('  FALSE  '), false, 'trims + case-insensitive');
});

Deno.test('isGhostOnlyMode: any truthy value → on', () => {
    assertEquals(isGhostOnlyMode('1'), true);
    assertEquals(isGhostOnlyMode('true'), true);
    assertEquals(isGhostOnlyMode('on'), true);
    assertEquals(isGhostOnlyMode('yes'), true);
});

Deno.test('kill-switch rows preserve one no-spend provenance decision per item', () => {
    const row = buildUnattemptedResolveSpotResult(
        { name: 'Kartuli', address: 'London', client_nonce: 'nonce-1' },
        'candidate-1',
    );
    assertEquals(row.client_nonce, 'nonce-1');
    assertEquals(row.resolution_decision, 'unattempted_budget');
    assertEquals(resolutionDecisionForCandidate(row), {
        decision: 'unattempted_budget',
        matchedExternalId: null,
    });
});

Deno.test('provenance preserves explicit rejection but real identity always wins as matched', () => {
    assertEquals(resolutionDecisionForCandidate({
        resolution_decision: 'locality_reject',
        external_id: null,
    }), { decision: 'locality_reject', matchedExternalId: null });
    assertEquals(resolutionDecisionForCandidate({
        resolution_decision: 'transient',
        restaurant: { external_id: 'ChIJ-server-held' },
    }), { decision: 'matched', matchedExternalId: 'ChIJ-server-held' });
});

Deno.test('resolve_spots failure rows preserve terminal and retryable decisions', () => {
    const item = { name: 'Kartuli', address: 'London', client_nonce: 'nonce-typed' };
    for (const decision of [
        'no_result',
        'name_reject',
        'locality_reject',
        'transient',
        'unattempted_budget',
    ] as const) {
        const row = buildResolveSpotDecisionResult(item, 'candidate-typed', decision);
        assertEquals(row.resolution_decision, decision);
        assertEquals(resolutionDecisionForCandidate(row), {
            decision,
            matchedExternalId: null,
        });
    }
});

Deno.test('places-search 429 distinguishes SKU budget deferral from interactive throttle', () => {
    assertEquals(
        placesFailureDecision(429, { error: { code: 'BUDGET_DEFERRED' } }),
        'unattempted_budget',
    );
    assertEquals(
        placesFailureDecision(429, { error: { code: 'RATE_LIMITED' } }),
        'transient',
    );
    assertEquals(placesFailureDecision(429, { error: 'opaque' }), 'transient');
    assertEquals(
        placesFailureDecision(503, { error: { code: 'PROVIDER_FAILURE' } }),
        'transient',
    );
});

Deno.test('resolve_spots deferred failure protocol is explicit v2 only', () => {
    assertEquals(isV2ResolveSpotsProtocol('v2'), true);
    assertEquals(isV2ResolveSpotsProtocol('legacy'), false);
    assertEquals(isV2ResolveSpotsProtocol(undefined), false);
    assertEquals(isV2ResolveSpotsProtocol({ generation: 'v2' }), false);
});

Deno.test('resolve_spots rate gate distinguishes infrastructure failure from budget denial', () => {
    assertEquals(resolveSpotsRateGate({ message: 'db unavailable' }, { allowed: false }), 'transient');
    assertEquals(resolveSpotsRateGate(null, null), 'transient');
    assertEquals(resolveSpotsRateGate(null, { allowed: false }), 'unattempted_budget');
    assertEquals(resolveSpotsRateGate(null, { allowed: true }), 'allowed');
});

Deno.test('failed Details evidence preserves only a provider-safe attempted id', () => {
    assertEquals(attemptedExternalIdFromResolutionEvidence({
        path: 'url',
        candidate: {
            resolution_decision: 'transient',
            attempted_external_id: '  ChIJ-known-details-id  ',
        },
    }), 'ChIJ-known-details-id');
    for (const attempted_external_id of [
        null,
        '',
        'ghost_pending',
        'ghost_owner_nonce',
        'merged_tombstone',
    ]) {
        assertEquals(attemptedExternalIdFromResolutionEvidence({
            candidate: { attempted_external_id },
        }), null);
    }
});

// ── 5. TICKET-195 import-only Places type backstop ───────────────────────────

Deno.test('hasAllowedImportPlaceType: real market payloads are accepted', () => {
    const marketPayloads = [
        {
            name: 'Barnes Farmers Market',
            categories: ['farmers_market', 'market', 'point_of_interest', 'establishment'],
        },
        {
            name: 'Borough Market',
            categories: ['farmers_market', 'tourist_attraction', 'market', 'point_of_interest'],
        },
    ];

    for (const { name, categories } of marketPayloads) {
        assertEquals(hasAllowedImportPlaceType(categories), true, `${name}: accepted`);
    }
});

Deno.test('hasAllowedImportPlaceType: real noise payloads remain rejected', () => {
    const noisePayloads = [
        ['thrift_store', 'womens_clothing_store', 'non_profit_organization'],
        ['association_or_organization', 'point_of_interest', 'establishment'],
        ['pharmacy', 'drugstore', 'consultant'],
        ['clothing_store', 'point_of_interest', 'store'],
        ['premise', 'street_address'],
    ];

    for (const categories of noisePayloads) {
        assertEquals(hasAllowedImportPlaceType(categories), false, `${categories.join(', ')}: rejected`);
    }
});

Deno.test('resolveImportPlaceSearch: every food/drink allowlist type accepts the top result', async () => {
    for (const category of IMPORT_PLACE_TYPE_ALLOWLIST) {
        let calls = 0;
        const top = { id: `place-${category}`, categories: ['point_of_interest', category] };
        const result = await resolveImportPlaceSearch(() => {
            calls += 1;
            return [top];
        });
        assertEquals(calls, 1, `${category}: injected search runs once`);
        assertEquals(result, { candidates: [top], typeRejected: false }, `${category}: accepted`);
    }
});

Deno.test('resolveImportPlaceSearch: non-venue top result is rejected and lower result is not promoted', async () => {
    const foundation = {
        id: 'foundation',
        categories: ['non_profit_organization', 'point_of_interest'],
    };
    const lowerCafe = { id: 'lower-cafe', categories: ['cafe', 'food'] };
    const result = await resolveImportPlaceSearch(() => [foundation, lowerCafe]);

    assertEquals(result, {
        candidates: [],
        typeRejected: true,
        rejectedCandidate: foundation,
    }, 'the top result is authoritative; scene-text junk must not fall through');
});

Deno.test('resolveImportPlaceSearch: absent/malformed top types fail closed as type rejection', async () => {
    for (const categories of [undefined, null, 'restaurant', [], [42]]) {
        const result = await resolveImportPlaceSearch(() => [{ id: 'bad-types', categories }]);
        assertEquals(result.typeRejected, true);
        assertEquals(result.candidates, []);
    }
});

Deno.test('resolveImportPlaceSearch: no Places result is ordinary no-match, not type rejection', async () => {
    const result = await resolveImportPlaceSearch(() => [] as Array<{ categories: string[] }>);
    assertEquals(result, { candidates: [], typeRejected: false });
});

Deno.test('keepTypeRejectedAsGhost: keeps only trusted extracted confidence', () => {
    assertEquals(keepTypeRejectedAsGhost('high'), true);
    assertEquals(keepTypeRejectedAsGhost('exact'), true);
    assertEquals(keepTypeRejectedAsGhost('low'), false);
    assertEquals(keepTypeRejectedAsGhost(undefined), false);
});

// ── Regression: a venue-type rejection must never swallow the spot ───────────
// Founder repro 2026-09-04: "Posada Real Torre Berrueza" extracted at high
// confidence with a real city; Google's top result typed it as lodging, the
// allowlist rejected it, and the URL path returned `candidates: []` — no ghost,
// no import_resolutions row, nothing on screen. The import vanished four times.

Deno.test('shouldEmitGhostCandidate: type rejection does NOT suppress the ghost', () => {
    assertEquals(
        shouldEmitGhostCandidate({
            resolvedCount: 0,
            extractedName: 'Posada Real Torre Berrueza',
            typeRejectedCount: 1,
        }),
        true,
    );
});

Deno.test('shouldEmitGhostCandidate: identical answer with and without a type rejection', () => {
    for (const typeRejectedCount of [0, 1, 5]) {
        assertEquals(
            shouldEmitGhostCandidate({
                resolvedCount: 0,
                extractedName: 'Some Inn',
                typeRejectedCount,
            }),
            true,
            `typeRejectedCount=${typeRejectedCount} must not change the outcome`,
        );
    }
});

Deno.test('shouldEmitGhostCandidate: no ghost once something actually resolved', () => {
    assertEquals(
        shouldEmitGhostCandidate({ resolvedCount: 1, extractedName: 'Kono' }),
        false,
    );
});

Deno.test('shouldEmitGhostCandidate: a ghost needs a real extracted name', () => {
    assertEquals(shouldEmitGhostCandidate({ resolvedCount: 0, extractedName: null }), false);
    assertEquals(shouldEmitGhostCandidate({ resolvedCount: 0, extractedName: '' }), false);
    assertEquals(shouldEmitGhostCandidate({ resolvedCount: 0, extractedName: '   ' }), false);
});

Deno.test('the allowlist still rejects lodging — the gate itself is unchanged', () => {
    assertEquals(hasAllowedImportPlaceType(['lodging', 'hotel']), false);
    assertEquals(hasAllowedImportPlaceType(['lodging', 'restaurant']), true);
});
