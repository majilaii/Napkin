import { callEdgeFn } from './edgeInvoke';

interface MatchCorrectionResult {
    resolution_id?: string | null;
}

/**
 * Mint fresh server-owned provenance for a human-selected replacement. Client
 * search evidence is never forwarded; the server reuses stored evidence only
 * when it actually attests the chosen place, otherwise it re-fetches Details.
 */
export async function mintImportMatchCorrection(input: {
    import_nonce: string;
    prior_resolution_id: string | null;
    chosen_external_id: string;
    expected_owner_id?: string;
}): Promise<string> {
    const result = await callEdgeFn<MatchCorrectionResult>('places-search', {
        action: 'match_correction',
        // places-search historically dispatches from the JSON payload while
        // most edge functions dispatch from `?action=`; carry both so rollout
        // is compatible across either handler shape.
        body: { action: 'match_correction', ...input },
    });
    if (!result?.resolution_id) {
        throw new Error('Match correction did not return provenance');
    }
    return result.resolution_id;
}
