import { callEdgeFn } from './edgeInvoke';
import { listRetiredRemoteImports, finishRetiredRemoteImport, type ImportManifest } from './importQueue';
import { dismissBackgroundImport, syncBackgroundImports } from './backgroundImports';
jest.mock('./edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('./importQueue', () => ({ listRetiredRemoteImports: jest.fn(() => []),
    finishRetiredRemoteImport: jest.fn() }));

const manifest = { jobId: 'capture', remoteJobId: 'capture', importNonce: 'nonce', userId: 'alice',
    url: 'https://www.tiktok.com/@chef/video/123' } as ImportManifest;
const edge = jest.mocked(callEdgeFn);
beforeEach(() => { jest.clearAllMocks(); jest.mocked(listRetiredRemoteImports).mockReturnValue([]); });
it('tombstones a server-lane job with its full capture identity (TICKET-248)', async () => {
    edge.mockResolvedValueOnce({ ok: true });
    await dismissBackgroundImport(manifest, () => 'alice');
    expect(edge).toHaveBeenCalledWith('background-imports', expect.objectContaining({ action: 'dismiss', body: {
        expected_owner_id: 'alice', job_id: 'capture', import_nonce: 'nonce', url: manifest.url,
    } }));
});
it('never dismisses for another account or a local-only manifest', async () => {
    await expect(dismissBackgroundImport(manifest, () => 'bob')).rejects.toThrow('owner changed');
    await dismissBackgroundImport({ ...manifest, remoteJobId: undefined }, () => 'alice');
    expect(edge).not.toHaveBeenCalled();
});
it('only clears a local cancellation after the server accepts its durable identity', async () => {
    jest.mocked(listRetiredRemoteImports).mockReturnValue([{ jobId: manifest.jobId, remoteJobId: manifest.remoteJobId!, importNonce: manifest.importNonce, url: manifest.url }]);
    edge.mockRejectedValueOnce(new Error('offline'));
    await expect(syncBackgroundImports('alice', () => 'alice')).rejects.toThrow('offline');
    expect(finishRetiredRemoteImport).not.toHaveBeenCalled();
    edge.mockResolvedValueOnce({ ok: true });
    await syncBackgroundImports('alice', () => 'alice');
    expect(finishRetiredRemoteImport).toHaveBeenCalledWith('capture', 'alice');
    expect(edge.mock.calls[1][1]).toEqual(expect.objectContaining({ action: 'dismiss', body: {
        expected_owner_id: 'alice', job_id: 'capture', import_nonce: 'nonce', url: manifest.url,
    } }));
});
it('does not call the server when nothing was retired', async () => {
    await syncBackgroundImports('alice', () => 'alice');
    expect(edge).not.toHaveBeenCalled();
});
