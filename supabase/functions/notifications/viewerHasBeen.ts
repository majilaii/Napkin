/** Preserve manual legacy intent; a new visit/undo never rewrites those toggles. */
export async function viewerHasBeen(
    supabase: { from: (table: string) => any },
    userId: string,
    restaurantId: string | null,
): Promise<boolean> {
    if (!restaurantId) return false;
    const results = await Promise.allSettled([
        supabase.from('user_restaurant_status').select('been')
            .eq('user_id', userId).eq('restaurant_id', restaurantId).maybeSingle(),
        supabase.from('entries').select('id')
            .eq('user_id', userId).eq('restaurant_id', restaurantId).limit(1),
        supabase.from('table_night_participants')
            .select('table_night_id, table_nights!inner(restaurant_id, kind, status)')
            .eq('user_id', userId).eq('table_nights.restaurant_id', restaurantId)
            .eq('table_nights.kind', 'live').in('table_nights.status', ['revealed', 'closed']).limit(1),
    ]);
    return results.some((result, index) => result.status === 'fulfilled'
        && !result.value.error
        && (index === 0 ? result.value.data?.been === true : result.value.data?.length > 0));
}
