/** IDs must come from the public-review eligibility RPC, never raw request IDs. */
// deno-lint-ignore no-explicit-any
export async function loadReviewPhotos(supabase: any, eligibleIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!eligibleIds.length) return result;
    const [photos, heroes] = await Promise.all([
        supabase.from('entry_photos').select('entry_id, photo_url').in('entry_id', eligibleIds)
            .order('sort_order', { ascending: true }).order('id', { ascending: true }),
        supabase.from('entries').select('id, photo_url').in('id', eligibleIds),
    ]);
    if (photos.error) throw photos.error;
    if (heroes.error) throw heroes.error;
    for (const photo of photos.data ?? []) {
        const urls = result.get(photo.entry_id) ?? [];
        if (photo.photo_url && !urls.includes(photo.photo_url)) urls.push(photo.photo_url);
        result.set(photo.entry_id, urls);
    }
    for (const entry of heroes.data ?? []) {
        const urls = result.get(entry.id) ?? [];
        if (entry.photo_url && !urls.includes(entry.photo_url)) urls.unshift(entry.photo_url);
        result.set(entry.id, urls);
    }
    return result;
}
