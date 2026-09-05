import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { countDatedVisitsSince, entryOrderDate, latestKnownVisit } from './visitDates.ts';

Deno.test('unknown dates can order records but cannot become a visit date or year count', () => {
    const unknown = { visited_at: null, created_at: '2026-09-05T12:00:00Z' };
    assertEquals(entryOrderDate(unknown), unknown.created_at);
    assertEquals(latestKnownVisit(null, unknown.visited_at), null);
    assertEquals(latestKnownVisit('2024-03-01', unknown.visited_at), '2024-03-01');
    assertEquals(countDatedVisitsSince([
        unknown,
        { visited_at: '2025-12-31' },
        { visited_at: '2026-01-01' },
    ], '2026-01-01'), 1);
});
