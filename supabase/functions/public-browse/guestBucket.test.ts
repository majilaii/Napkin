import { assertEquals, assertMatch, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { clientIp, guestBucketId } from './guestBucket.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.test('clientIp prefers cf-connecting-ip over a forged x-forwarded-for', () => {
    const headers = new Headers({
        'cf-connecting-ip': '198.51.100.7',
        'x-forwarded-for': '203.0.113.9, 198.51.100.7',
        'x-real-ip': '10.0.0.1',
    });
    assertEquals(clientIp(headers), { ip: '198.51.100.7', source: 'cf-connecting-ip' });
});

Deno.test('clientIp falls back to the first x-forwarded-for hop, then x-real-ip, then unknown', () => {
    assertEquals(
        clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'x-real-ip': '10.0.0.2' })),
        { ip: '203.0.113.9', source: 'x-forwarded-for' },
    );
    assertEquals(clientIp(new Headers({ 'x-real-ip': '198.51.100.4' })), {
        ip: '198.51.100.4',
        source: 'x-real-ip',
    });
    assertEquals(clientIp(new Headers()), { ip: 'unknown', source: 'unknown' });
});

Deno.test('clientIp ignores blank header values', () => {
    assertEquals(
        clientIp(new Headers({ 'cf-connecting-ip': '  ', 'x-forwarded-for': ' , 10.0.0.1', 'x-real-ip': '198.51.100.4' })),
        { ip: '198.51.100.4', source: 'x-real-ip' },
    );
});

Deno.test('guestBucketId is a uuid, stable within a day for one ip', async () => {
    const now = new Date('2026-09-22T10:00:00Z');
    const a = await guestBucketId(new Headers({ 'cf-connecting-ip': '203.0.113.9' }), now);
    const b = await guestBucketId(new Headers({ 'cf-connecting-ip': '203.0.113.9' }), now);
    assertMatch(a, UUID);
    assertEquals(a, b);
});

Deno.test('guestBucketId differs across ips and across days (daily salt)', async () => {
    const day1 = new Date('2026-09-22T10:00:00Z');
    const day2 = new Date('2026-09-23T10:00:00Z');
    const ipA = new Headers({ 'cf-connecting-ip': '203.0.113.9' });
    const ipB = new Headers({ 'cf-connecting-ip': '203.0.113.10' });
    assertNotEquals(await guestBucketId(ipA, day1), await guestBucketId(ipB, day1));
    assertNotEquals(await guestBucketId(ipA, day1), await guestBucketId(ipA, day2));
});

Deno.test('a forged x-forwarded-for does not move the bucket when cf-connecting-ip is present', async () => {
    const now = new Date('2026-09-22T10:00:00Z');
    const honest = await guestBucketId(new Headers({ 'cf-connecting-ip': '198.51.100.7' }), now);
    const forged = await guestBucketId(
        new Headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.200' }),
        now,
    );
    assertEquals(forged, honest);
});

Deno.test('guestBucketId never contains the raw ip', async () => {
    const id = await guestBucketId(new Headers({ 'cf-connecting-ip': '203.0.113.9' }));
    assertEquals(id.includes('203'), false);
});
