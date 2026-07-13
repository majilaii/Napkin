/**
 * Resolve the live content owner for a handoff token.
 *
 * Legacy and author-created shares read from `owner_id`. A viewer may relay an
 * authored public list, but the token must remain owned/revocable by that viewer.
 * Those tokens store only this strict marker in the service-role-only snapshot
 * column; every read still re-authorizes the public source live.
 */

const PUBLIC_LIST_RELAY_KIND = 'public_list_relay_v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ShareLiveSource {
    sourceOwnerId: string;
    /** Non-null means the source must keep passing the public-list gate. */
    publicViewerId: string | null;
}
export function buildPublicListRelayMarker(sourceOwnerId: string): Record<string, string> {
    return {
        kind: PUBLIC_LIST_RELAY_KIND,
        source_owner_id: sourceOwnerId,
    };
}

export function resolveShareLiveSource(
    tokenOwnerId: string,
    snapshot: unknown,
): ShareLiveSource {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return { sourceOwnerId: tokenOwnerId, publicViewerId: null };
    }

    const marker = snapshot as Record<string, unknown>;
    const keys = Object.keys(marker).sort();
    const isExactMarker =
        keys.length === 2
        && keys[0] === 'kind'
        && keys[1] === 'source_owner_id'
        && marker.kind === PUBLIC_LIST_RELAY_KIND
        && typeof marker.source_owner_id === 'string'
        && UUID_RE.test(marker.source_owner_id)
        && marker.source_owner_id !== tokenOwnerId;

    if (!isExactMarker) {
        // Fail closed: malformed/legacy metadata can only read from the token owner.
        return { sourceOwnerId: tokenOwnerId, publicViewerId: null };
    }

    return {
        sourceOwnerId: marker.source_owner_id as string,
        publicViewerId: tokenOwnerId,
    };
}
