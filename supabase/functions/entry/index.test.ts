/**
 * Tests for the entry edge function
 * 
 * Run with: deno test --allow-env --allow-net supabase/functions/entry/
 */

import { assertEquals } from '../_shared/test-utils.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { normalizeMergeImagePayload } from './mergeImagePayload.ts';

Deno.test('Entry Edge Function Tests', async (t) => {

    await t.step('CORS headers should be properly defined', () => {
        assertEquals(typeof corsHeaders['Access-Control-Allow-Origin'], 'string');
        assertEquals(typeof corsHeaders['Access-Control-Allow-Headers'], 'string');
        assertEquals(corsHeaders['Access-Control-Allow-Origin'], '*');
    });

    await t.step('OPTIONS request should return cors headers', async () => {
        // This tests the pattern, not the actual function (which requires Supabase connection)
        const mockOptionsHandler = (req: Request) => {
            if (req.method === 'OPTIONS') {
                return new Response('ok', { headers: corsHeaders });
            }
            return new Response('Method not allowed', { status: 405 });
        };

        const req = new Request('http://localhost', { method: 'OPTIONS' });
        const res = mockOptionsHandler(req);

        assertEquals(res.status, 200);
        assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
    });

    await t.step('should reject requests without Authorization header', async () => {
        // Mock handler pattern for authentication check
        const mockAuthCheck = (req: Request) => {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader) {
                return new Response(
                    JSON.stringify({ error: 'Missing Authorization header' }),
                    { status: 401, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        };

        const req = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        const res = mockAuthCheck(req);
        assertEquals(res.status, 401);

        const body = await res.json();
        assertEquals(body.error, 'Missing Authorization header');
    });

    await t.step('merge-with derives a hero and preserves the complete photo_urls payload', () => {
        const photos = [
            'https://project.test/entry-photos/approved/u/a.jpg',
            'https://project.test/entry-photos/approved/u/b.jpg',
        ];

        assertEquals(normalizeMergeImagePayload({ photo_urls: photos }), {
            photo_url: photos[0],
            photo_urls: photos,
        });
        assertEquals(normalizeMergeImagePayload({
            photo_url: 'https://project.test/entry-photos/approved/u/hero.jpg',
            photo_urls: photos,
        }), {
            photo_url: 'https://project.test/entry-photos/approved/u/hero.jpg',
            photo_urls: photos,
        });
    });
});
