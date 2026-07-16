import type { PersistedImportSpot } from './importQueue';
import { safeRandomUUID } from './uuid';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ManualImportPlace {
    id: string;
    external_id?: string | null;
    name: string;
    city: string | null;
    cuisine: string | null;
}

/**
 * Reconcile a confirmed spot with the Tables chosen during in-app review.
 * Existing per-(spot, table) nonces are preserved for replay safety; new
 * destinations receive a nonce once, removed destinations are pruned, and the
 * legacy single-table fields mirror the first current selection.
 */
export function reconcileImportSpotTables(
    spot: PersistedImportSpot,
    tableIds: string[],
    uuid: () => string = safeRandomUUID,
): PersistedImportSpot {
    const uniqueTableIds = [...new Set(tableIds)];
    const tableShares: Record<string, string> = {};

    for (const tableId of uniqueTableIds) {
        const existing =
            spot.table_shares?.[tableId] ??
            (spot.table_id === tableId ? spot.table_client_nonce : null);
        tableShares[tableId] = existing || uuid();
    }

    const firstTableId = uniqueTableIds[0] ?? null;
    return {
        ...spot,
        table_id: firstTableId,
        table_client_nonce: firstTableId ? tableShares[firstTableId] : null,
        table_shares: tableShares,
    };
}

/** Build the frozen manifest row for a place the user adds during review. */
export function createManualImportSpot(
    result: ManualImportPlace,
    tableIds: string[],
    uuid: () => string = safeRandomUUID,
    resolutionId: string | null = null,
): PersistedImportSpot {
    const isNapkinId = UUID_RE.test(result.id);
    const externalId = result.external_id ?? (isNapkinId ? null : result.id);
    const tableShares: Record<string, string> = {};
    for (const tableId of tableIds) tableShares[tableId] = uuid();

    return {
        candidate_id: uuid(),
        client_nonce: uuid(),
        resolution_id: resolutionId,
        restaurant_id: isNapkinId ? result.id : null,
        external_id: isNapkinId ? null : externalId,
        restaurant_name: result.name,
        restaurant_city: result.city,
        table_id: tableIds[0] ?? null,
        table_client_nonce: tableIds[0] ? tableShares[tableIds[0]] : null,
        table_shares: tableShares,
        place: isNapkinId
            ? null
            : {
                  external_id: externalId,
                  name: result.name,
                  location: { locality: result.city ?? undefined },
                  cuisine: result.cuisine,
              },
        stance: 'recommended',
    };
}
