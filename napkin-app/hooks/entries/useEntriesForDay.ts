/**
 * useEntriesForDay — fetches the viewer's entries for a given calendar day.
 *
 * The target window is LOCAL time, but the PostgREST `timestamptz` filter must be
 * anchored to UTC instants to compare correctly. We widen the SQL range by ±1 day
 * (to cover timezone offset in either direction plus the overnight rollover where
 * hour 0–3 maps to the prior day's dinner slot), then let mapEntriesToSlots do
 * the precise local-date filtering.
 *
 * Direct Supabase query — RLS already scopes to own entries.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapEntriesToSlots } from '@/lib/mealSlots';
import { queryKeys } from '@/lib/queryKeys';
import type { SlotEntry, MealSlot } from '@/lib/mealSlots';

interface EntryRow {
    id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    visited_at: string | null;
    restaurants: { name: string } | null;
}

async function fetchEntriesForDay(
    userId: string,
    date: string,
): Promise<Partial<Record<MealSlot, SlotEntry>>> {
    const [year, month, day] = date.split('-').map(Number);
    // Widen ±1 day in local time, then convert each endpoint to a UTC ISO string
    // so PostgREST's timestamptz comparison does the right thing regardless of
    // the user's timezone. mapEntriesToSlots handles precise local-day filtering.
    const startLocal = new Date(year, month - 1, day - 1, 0, 0, 0, 0);
    const endLocal = new Date(year, month - 1, day + 1, 23, 59, 59, 999);

    const { data, error } = await (supabase
        .from('entries')
        .select(`
            id,
            restaurant_id,
            rating,
            content,
            visited_at,
            restaurants ( name )
        `)
        .eq('user_id', userId)
        .gte('visited_at', startLocal.toISOString())
        .lte('visited_at', endLocal.toISOString())
        .order('visited_at', { ascending: true }) as any);

    if (error) throw error;

    const rows = (data ?? []) as EntryRow[];
    return mapEntriesToSlots(rows, date);
}

export function useEntriesForDay(userId: string | undefined, date: string) {
    return useQuery({
        queryKey: userId ? queryKeys.entries.forDay(userId, date) : ['entriesForDay', 'anon', date],
        queryFn: () => fetchEntriesForDay(userId!, date),
        enabled: !!userId && !!date,
        staleTime: 1000 * 60 * 2,
    });
}
