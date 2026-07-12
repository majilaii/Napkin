import type { PersistedImportSpot } from './importQueue';
import { safeRandomUUID } from './uuid';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ManualImportPlace {
    id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
}

/** Build the frozen manifest row for a place the user adds during review. */
export function createManualImportSpot(
    result: ManualImportPlace,
    tableIds: string[],
    uuid: () => string = safeRandomUUID,
): PersistedImportSpot {
    const isNapkinId = UUID_RE.test(result.id);
    const tableShares: Record<string, string> = {};
    for (const tableId of tableIds) tableShares[tableId] = uuid();

    return {
        candidate_id: uuid(),
        client_nonce: uuid(),
        restaurant_id: isNapkinId ? result.id : null,
        external_id: isNapkinId ? null : result.id,
        restaurant_name: result.name,
        restaurant_city: result.city,
        table_id: tableIds[0] ?? null,
        table_client_nonce: tableIds[0] ? tableShares[tableIds[0]] : null,
        table_shares: tableShares,
        place: isNapkinId
            ? null
            : {
                  external_id: result.id,
                  name: result.name,
                  location: { locality: result.city ?? undefined },
                  cuisine: result.cuisine,
              },
        stance: 'recommended',
    };
}
