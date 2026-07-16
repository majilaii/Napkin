import { callEdgeFn } from '@/lib/edgeInvoke';

export interface MergeRequestInput {
    entry_a_id: string;
    table_id: string;
    restaurant_id: string;
    visited_at: string;
    client_nonce: string;
}

/** Build the exact merge-with wire body without dropping staged photo_urls. */
export function buildMergeWithRequestBody<T extends MergeRequestInput>(input: T) {
    const {
        entry_a_id,
        table_id,
        restaurant_id,
        visited_at,
        client_nonce,
        ...bPayload
    } = input;

    return {
        action: 'merge_with' as const,
        entry_a_id,
        table_id,
        restaurant_id,
        visited_at,
        client_nonce,
        ...bPayload,
    };
}

/** Invoke the real merge-with Edge route using the exact payload builder above. */
export async function callMergeWith<
    TInput extends MergeRequestInput,
    TResponse = unknown,
>(input: TInput): Promise<TResponse> {
    return callEdgeFn<TResponse>('entry', {
        body: buildMergeWithRequestBody(input),
    });
}
