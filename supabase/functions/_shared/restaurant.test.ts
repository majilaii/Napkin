/**
 * Tests for _shared/restaurant.ts::upsertRestaurant — TICKET-081 fix-pass.
 *
 * Focus: the hours-write normalization (Codex MEDIUM) — a blank / whitespace /
 * non-string-array hours payload must NOT overwrite good metadata; the `hours`
 * key must be omitted from the upsert row entirely. Also asserts places_synced_at
 * is stamped whenever any Places field is written, and openNow is never persisted.
 *
 * Run with: deno test --allow-env supabase/functions/_shared/restaurant.test.ts
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { upsertRestaurant } from './restaurant.ts';

/**
 * Minimal capturing mock: records the row passed to .upsert() so we can assert on
 * exactly which columns were written. Returns a non-null photo_url so the hero-photo
 * branch never fires (no network).
 */
function captureMock() {
    const captured: { upsertRow: Record<string, unknown> | null } = { upsertRow: null };
    const client = {
        from: (_table: string) => ({
            upsert: (row: Record<string, unknown>) => {
                captured.upsertRow = row;
                return {
                    select: () => ({
                        single: () =>
                            Promise.resolve({
                                data: { id: 'rid-1', photo_url: 'https://x/p.jpg' },
                                error: null,
                            }),
                    }),
                };
            },
        }),
    };
    return { client, captured };
}

Deno.test('upsertRestaurant hours normalization (TICKET-081 fix-pass)', async (t) => {
    await t.step('blank/whitespace hours payload does NOT write hours', async () => {
        const { client, captured } = captureMock();
        await upsertRestaurant(client as any, {
            external_id: 'ChIJblank',
            name: 'Blank Hours',
            // garbage: empty + whitespace + non-string entries
            hours: { weekdayDescriptions: ['', '   ', 42 as any, null as any] },
        });
        assertEquals('hours' in (captured.upsertRow ?? {}), false);
    });

    await t.step('non-array / null hours does NOT write hours', async () => {
        const { client, captured } = captureMock();
        await upsertRestaurant(client as any, {
            external_id: 'ChIJnull',
            name: 'Null Hours',
            hours: null,
        });
        assertEquals('hours' in (captured.upsertRow ?? {}), false);
    });

    await t.step('usable descriptions ARE written, trimmed, openNow never persisted', async () => {
        const { client, captured } = captureMock();
        await upsertRestaurant(client as any, {
            external_id: 'ChIJgood',
            name: 'Good Hours',
            // a stray openNow on the object must not leak into the stored payload
            hours: {
                weekdayDescriptions: ['  Monday: 9–5  ', '', 'Tuesday: 9–5'],
                openNow: true,
            } as any,
        });
        assertEquals(captured.upsertRow?.hours, {
            weekdayDescriptions: ['Monday: 9–5', 'Tuesday: 9–5'],
        });
    });

    await t.step('a usable-hours write stamps places_synced_at', async () => {
        const { client, captured } = captureMock();
        await upsertRestaurant(client as any, {
            external_id: 'ChIJstamp',
            name: 'Stamp',
            hours: { weekdayDescriptions: ['Monday: 9–5'] },
        });
        const stamped = captured.upsertRow?.places_synced_at;
        assertEquals(typeof stamped === 'string' && stamped.length > 0, true);
    });

    await t.step('phone-only backfill (no ratings) still stamps places_synced_at', async () => {
        const { client, captured } = captureMock();
        await upsertRestaurant(client as any, {
            external_id: 'ChIJphone',
            name: 'Phone Only',
            phone: '+1 555 0100',
        });
        assertEquals(captured.upsertRow?.phone, '+1 555 0100');
        const stamped = captured.upsertRow?.places_synced_at;
        assertEquals(typeof stamped === 'string' && stamped.length > 0, true);
    });

    await t.step('a name-only sparse upsert does NOT stamp places_synced_at or write hours', async () => {
        const { client, captured } = captureMock();
        await upsertRestaurant(client as any, {
            external_id: 'ChIJsparse',
            name: 'Sparse',
        });
        // No Places field carried → sentinel untouched (preserves a prior real sync).
        assertEquals('places_synced_at' in (captured.upsertRow ?? {}), false);
        assertEquals('hours' in (captured.upsertRow ?? {}), false);
    });
});
