import { importNoticeDetail, importNoticeUrl, importNotificationMatchesOwner } from './importNotificationNavigation';
import type { ImportManifest } from './importQueue';
const serverId = 'a1234567-1111-2222-3333-123456789abc';
const review = { jobId: 'local-1', userId: 'alice', mode: 'review', status: 'pending', spots: [{}] } as ImportManifest;
it('blocks old-account import push routes before entering the hub', () => {
    expect(importNotificationMatchesOwner('/import-progress?openJob=a&owner=alice', 'bob')).toBe(false);
    expect(importNotificationMatchesOwner('/import-progress?openJob=a&owner=alice', 'alice')).toBe(true);
    expect(importNotificationMatchesOwner('/import-progress?owner=alice', null)).toBe(false);
});
const resolve = (edits: Partial<Parameters<typeof importNoticeDetail>[0]> = {}) => importNoticeDetail({
    jobId: 'local-1', outcome: 'review', currentUserId: 'alice', manifests: [review], ...edits,
});
it('preserves a hub parent and encodes target identity', () => {
    expect(importNoticeUrl('a/b', 'review', 'alice')).toBe('/import-progress?openJob=a%2Fb&outcome=review&owner=alice');
    expect(importNoticeUrl()).toBe('/import-progress');
});
it('opens the matching held review', () => expect(resolve()).toBe('/import-review?jobId=local-1'));
it('revalidates consumed, missing and failed local reviews', () => {
    expect(resolve({ manifests: [] })).toBeNull();
    expect(resolve({ manifests: [{ ...review, mode: 'auto' }] })).toBeNull();
    expect(resolve({ manifests: [{ ...review, status: 'failed' }] })).toBeNull();
    expect(resolve({ outcome: 'failed' })).toBeNull();
});
it('refuses another owner and signed-out navigation', () => {
    expect(resolve({ currentUserId: 'bob' })).toBeNull();
    expect(resolve({ ownerId: 'bob' })).toBeNull();
    expect(resolve({ currentUserId: undefined })).toBeNull();
});
it('opens a saved server batch after local manifest cleanup', () => {
    expect(resolve({ jobId: serverId, outcome: 'saved', manifests: [] })).toBe(`/imports/${serverId}`);
    expect(resolve({ jobId: 'local-1', outcome: 'saved', manifests: [] })).toBeNull();
    expect(resolve({ jobId: serverId, outcome: 'saved', ownerId: 'bob', manifests: [] })).toBeNull();
});
it('maps large server identities to the owned local digest only once done', () => {
    const large = { ...review, largeJob: { phase: 'done', serverJobId: serverId } } as ImportManifest;
    expect(resolve({ jobId: serverId, manifests: [large] })).toBe('/import-digest?jobId=local-1');
    expect(resolve({ jobId: serverId, manifests: [{ ...large, largeJob: { ...large.largeJob!, phase: 'running' } }] })).toBeNull();
});
