import { callEdgeFn } from './edgeInvoke';
import { getImportForUser, listRetiredRemoteImports, finishRetiredRemoteImport, type ImportManifest } from './importQueue';
import { readBackgroundImport, syncBackgroundImports, BackgroundImportRejectedError } from './backgroundImports';
jest.mock('./edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('./importQueue', () => ({ getImportForUser: jest.fn(), listRetiredRemoteImports: jest.fn(() => []),
    finishRetiredRemoteImport: jest.fn() }));

const manifest = { jobId: 'capture', remoteJobId: 'capture', importNonce: 'nonce', userId: 'alice',
    url: 'https://www.tiktok.com/@chef/video/123' } as ImportManifest;
const edge = jest.mocked(callEdgeFn);
beforeEach(() => { jest.clearAllMocks(); jest.mocked(getImportForUser).mockReturnValue(manifest);
    jest.mocked(listRetiredRemoteImports).mockReturnValue([]); });
it('retries an unaccepted upload using the exact original identity', async () => {
    edge.mockRejectedValueOnce({ cause: { status: 404 } }).mockResolvedValueOnce({});
    expect(await readBackgroundImport(manifest, () => 'alice')).toBeNull();
    expect(edge.mock.calls[1][1]).toEqual(expect.objectContaining({ action: 'enqueue', body: {
        expected_owner_id: 'alice', job_id: 'capture', import_nonce: 'nonce', url: manifest.url, protocol_generation: 'v2', installation_id: null,
    } }));
});
it('keeps ambiguous server failures remote instead of starting a second resolver', async () => {
    edge.mockRejectedValueOnce(new Error('timeout'));
    await expect(readBackgroundImport(manifest, () => 'alice')).rejects.toThrow('timeout');
    expect(edge).toHaveBeenCalledTimes(1);
});
it('exposes a permanently rejected upload as recoverable failure instead of waiting forever', async () => {
    edge.mockRejectedValueOnce({ cause: { status: 404 } }).mockRejectedValueOnce({ cause: { status: 400 } });
    await expect(readBackgroundImport({ ...manifest, url: `https://example.com/${'x'.repeat(2049)}` }, () => 'alice'))
        .rejects.toBeInstanceOf(BackgroundImportRejectedError);
});
it('rejects a delayed response after account switching', async () => {
    let owner = 'alice'; edge.mockImplementationOnce(async () => { owner = 'bob'; return {} as never; });
    await expect(readBackgroundImport(manifest, () => owner)).rejects.toThrow('owner changed');
});
it('does not reenqueue a capture that was dismissed during the status request', async () => {
    edge.mockImplementationOnce(async () => { jest.mocked(getImportForUser).mockReturnValue(null); throw { cause: { status: 404 } }; });
    expect(await readBackgroundImport(manifest, () => 'alice')).toBeNull();
    expect(edge).toHaveBeenCalledTimes(1);
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
it('does not clone another installation review and its save nonces', async () => {
    await syncBackgroundImports('alice', () => 'alice');
    expect(edge).not.toHaveBeenCalled();
});
