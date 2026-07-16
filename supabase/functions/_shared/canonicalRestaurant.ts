/**
 * Resolve a restaurant id through TICKET-195's tombstone-alias chain.
 *
 * Edge functions use the service-role client, so every raw restaurant id that
 * can outlive canonicalisation must opt in explicitly instead of relying on
 * RLS or a PostgREST embed to hide aliases.
 */
export async function resolveCanonicalRestaurantId(
    supabase: any,
    restaurantId: string,
): Promise<string> {
    const { data, error } = await supabase.rpc('fn_resolve_canonical', {
        p_id: restaurantId,
    });
    if (error) throw error;
    return typeof data === 'string' && data.length > 0 ? data : restaurantId;
}

/** Resolve a UUID directly, or translate an external id before following aliases. */
export async function resolveRestaurantLookupId(
    supabase: any,
    rawId: string,
): Promise<string | null> {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let restaurantId = rawId;

    if (!uuidPattern.test(rawId)) {
        const { data, error } = await supabase
            .from('restaurants')
            .select('id')
            .eq('external_id', rawId)
            .maybeSingle();
        if (error) throw error;
        if (!data?.id) return null;
        restaurantId = data.id as string;
    }

    return await resolveCanonicalRestaurantId(supabase, restaurantId);
}

/** Resolve a batch while retaining a mapping for immutable tombstone FKs. */
export async function resolveCanonicalRestaurantIds(
    supabase: any,
    restaurantIds: string[],
): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(restaurantIds)];
    const resolved = await Promise.all(
        uniqueIds.map(async (id) => [id, await resolveCanonicalRestaurantId(supabase, id)] as const),
    );
    return new Map(resolved);
}
