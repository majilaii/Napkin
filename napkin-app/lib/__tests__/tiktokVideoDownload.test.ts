import { downloadTikTokVideo as downloadWithFileSystem } from '../tiktokPerception';

const mockTask = { downloadAsync: jest.fn(), cancelAsync: jest.fn() };
const mockFileSystem = {
    cacheDirectory: 'file://cache/' as string | null,
    createDownloadResumable: jest.fn(),
    deleteAsync: jest.fn(),
};

jest.mock('expo-file-system/legacy', () => mockFileSystem);

function downloadTikTokVideo(address: string, page: string, timeout: number, signal?: AbortSignal) {
    return downloadWithFileSystem(address, page, timeout, signal,
        async () => jest.requireMock('expo-file-system/legacy'));
}

const address = 'https://signed.example/video.mp4';
const page = 'https://www.tiktok.com/@creator/video/123';
let targetUri: string;

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
    mockFileSystem.cacheDirectory = 'file://cache/';
    mockFileSystem.createDownloadResumable.mockReset().mockImplementation((_address, uri: string) => {
        targetUri = uri;
        return mockTask;
    });
    mockFileSystem.deleteAsync.mockReset().mockResolvedValue(undefined);
    mockTask.cancelAsync.mockReset().mockResolvedValue(undefined);
    mockTask.downloadAsync.mockReset().mockImplementation(async () => ({ uri: targetUri, status: 200 }));
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

test('successful downloads preserve the required referer and transfer file ownership to the caller', async () => {
    const controller = new AbortController();
    const result = await downloadTikTokVideo(address, page, 1000, controller.signal);
    expect(result).toBe(targetUri);
    expect(mockFileSystem.createDownloadResumable).toHaveBeenCalledWith(address, expect.stringContaining('file://cache/tiktok-import-'), {
        headers: { Referer: page, 'User-Agent': expect.stringContaining('iPhone') },
    });
    expect(mockTask.cancelAsync).not.toHaveBeenCalled();
    expect(mockFileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    controller.abort();
    expect(mockTask.cancelAsync).not.toHaveBeenCalled();
});

test.each([0, -1])('exhausted timeout %p never creates a native download task', async timeout => {
    await expect(downloadTikTokVideo(address, page, timeout)).resolves.toBeNull();
    expect(mockFileSystem.createDownloadResumable).not.toHaveBeenCalled();
});

test('already-aborted downloads never touch the filesystem', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(downloadTikTokVideo(address, page, 1000, controller.signal)).resolves.toBeNull();
    expect(mockFileSystem.createDownloadResumable).not.toHaveBeenCalled();
});

test('abort during lazy filesystem loading is rechecked before creating a task', async () => {
    const controller = new AbortController();
    const running = downloadTikTokVideo(address, page, 1000, controller.signal);
    controller.abort();
    await expect(running).resolves.toBeNull();
    expect(mockFileSystem.createDownloadResumable).not.toHaveBeenCalled();
    expect(mockTask.downloadAsync).not.toHaveBeenCalled();
});

test('filesystem loading consumes the same timeout instead of granting a fresh download deadline', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1001);
    await expect(downloadTikTokVideo(address, page, 1000)).resolves.toBeNull();
    expect(mockFileSystem.createDownloadResumable).not.toHaveBeenCalled();
});

test('missing cache directory degrades without a native task', async () => {
    mockFileSystem.cacheDirectory = null;
    await expect(downloadTikTokVideo(address, page, 1000)).resolves.toBeNull();
    expect(mockFileSystem.createDownloadResumable).not.toHaveBeenCalled();
});

test('forbidden CDN responses clean the error-body file and never reach OCR', async () => {
    mockTask.downloadAsync.mockImplementation(async () => ({ uri: targetUri, status: 403 }));
    await expect(downloadTikTokVideo(address, page, 1000)).resolves.toBeNull();
    expect(mockFileSystem.deleteAsync).toHaveBeenCalledWith(targetUri, { idempotent: true });
    expect(jest.getTimerCount()).toBe(0);
});

test('failed native promises clean partial files without escaping a rejection', async () => {
    mockTask.downloadAsync.mockRejectedValue(new Error('Network offline'));
    await expect(downloadTikTokVideo(address, page, 1000)).resolves.toBeNull();
    expect(mockFileSystem.deleteAsync).toHaveBeenCalledWith(targetUri, { idempotent: true });
    expect(jest.getTimerCount()).toBe(0);
});

test('undefined native cancellation results clean partial files', async () => {
    mockTask.downloadAsync.mockResolvedValue(undefined);
    await expect(downloadTikTokVideo(address, page, 1000)).resolves.toBeNull();
    expect(mockFileSystem.deleteAsync).toHaveBeenCalledWith(targetUri, { idempotent: true });
});

test('timeout cancels promptly and cleans a late successful native completion again', async () => {
    const pending = deferred<{ uri: string; status: number }>();
    mockTask.downloadAsync.mockReturnValue(pending.promise);
    const running = downloadTikTokVideo(address, page, 1000);
    await flush();
    expect(mockTask.downloadAsync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(running).resolves.toBeNull();
    expect(mockTask.cancelAsync).toHaveBeenCalledTimes(1);
    expect(mockFileSystem.deleteAsync).toHaveBeenCalledTimes(1);
    pending.resolve({ uri: targetUri, status: 200 });
    await flush();
    expect(mockFileSystem.deleteAsync).toHaveBeenCalledTimes(2);
    expect(mockFileSystem.deleteAsync).toHaveBeenLastCalledWith(targetUri, { idempotent: true });
    expect(jest.getTimerCount()).toBe(0);
});

test('timeout also handles a late native rejection without unhandled rejection or file residue', async () => {
    const pending = deferred<{ uri: string; status: number }>();
    mockTask.downloadAsync.mockReturnValue(pending.promise);
    const running = downloadTikTokVideo(address, page, 1000);
    await flush();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(running).resolves.toBeNull();
    pending.reject(new Error('Cancelled native task'));
    await flush();
    expect(mockFileSystem.deleteAsync).toHaveBeenCalledTimes(2);
});

test('abort cancels once, removes its listener/timer, and cleans a late native write', async () => {
    const pending = deferred<{ uri: string; status: number }>();
    mockTask.downloadAsync.mockReturnValue(pending.promise);
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    const running = downloadTikTokVideo(address, page, 1000, controller.signal);
    await flush();
    controller.abort();
    await expect(running).resolves.toBeNull();
    controller.abort();
    expect(mockTask.cancelAsync).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(jest.getTimerCount()).toBe(0);
    pending.resolve({ uri: targetUri, status: 200 });
    await flush();
    expect(mockFileSystem.deleteAsync).toHaveBeenCalledTimes(2);
});

test('native cancellation rejection does not prevent abort cleanup', async () => {
    const pending = deferred<{ uri: string; status: number }>();
    mockTask.downloadAsync.mockReturnValue(pending.promise);
    mockTask.cancelAsync.mockRejectedValue(new Error('Native cancellation unavailable'));
    const controller = new AbortController();
    const running = downloadTikTokVideo(address, page, 1000, controller.signal);
    await flush();
    controller.abort();
    await expect(running).resolves.toBeNull();
    expect(mockFileSystem.deleteAsync).toHaveBeenCalledWith(targetUri, { idempotent: true });
    pending.reject(new Error('Download eventually failed'));
    await flush();
});

test('cleanup rejection remains best-effort after a failed download', async () => {
    mockTask.downloadAsync.mockRejectedValue(new Error('Download failed'));
    mockFileSystem.deleteAsync.mockRejectedValue(new Error('File already gone'));
    await expect(downloadTikTokVideo(address, page, 1000)).resolves.toBeNull();
    expect(jest.getTimerCount()).toBe(0);
});
