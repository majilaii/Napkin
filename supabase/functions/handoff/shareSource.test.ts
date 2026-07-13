import {
    assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    buildPublicListRelayMarker,
    resolveShareLiveSource,
} from './shareSource.ts';

const VIEWER = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';

Deno.test('resolveShareLiveSource: legacy/owner share reads from token owner', () => {
    assertEquals(resolveShareLiveSource(VIEWER, null), {
        sourceOwnerId: VIEWER,
        publicViewerId: null,
    });
});
Deno.test('resolveShareLiveSource: public relay keeps viewer as gate and reads author', () => {
    assertEquals(
        resolveShareLiveSource(VIEWER, buildPublicListRelayMarker(AUTHOR)),
        { sourceOwnerId: AUTHOR, publicViewerId: VIEWER },
    );
});

Deno.test('resolveShareLiveSource: malformed or extended marker fails closed', () => {
    assertEquals(resolveShareLiveSource(VIEWER, {
        ...buildPublicListRelayMarker(AUTHOR),
        unexpected: true,
    }), {
        sourceOwnerId: VIEWER,
        publicViewerId: null,
    });
    assertEquals(resolveShareLiveSource(VIEWER, {
        kind: 'public_list_relay_v1',
        source_owner_id: 'not-a-uuid',
    }), {
        sourceOwnerId: VIEWER,
        publicViewerId: null,
    });
});
