import type { ExtractResult } from '../src/MediaExtract.types';

const mockNative: { apiVersion?: number; extractFromVideo: jest.Mock } = {
    apiVersion: 4,
    extractFromVideo: jest.fn(),
};

jest.mock('expo', () => ({ requireNativeModule: () => mockNative }), { virtual: true });
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const result: ExtractResult = {
    ocr: ['LOTTA'], transcript: '', durationSec: 15.76,
    frames: [{ timeSec: 15.56, lines: ['LOTTA'] }],
};

function loadWrapper(): typeof import('../index') {
    return jest.requireActual('../index');
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

beforeEach(() => {
    jest.resetModules();
    mockNative.apiVersion = 4;
    mockNative.extractFromVideo.mockReset().mockResolvedValue(result);
});

test('v4 defaults give all entry points 240/2 and preserve timestamped evidence', async () => {
    const { extractFromVideo } = loadWrapper();
    await expect(extractFromVideo('file://clip.mp4')).resolves.toBe(result);
    expect(mockNative.extractFromVideo).toHaveBeenCalledWith('file://clip.mp4', 240, 2, true, 45000, 90000, 300);
});

test('v3 results need no frames field and retain the seven-argument signature', async () => {
    mockNative.apiVersion = 3;
    const legacy = { ocr: ['LOTTA'], transcript: '', durationSec: 15.76 };
    mockNative.extractFromVideo.mockResolvedValue(legacy);
    await expect(loadWrapper().extractFromVideo('clip')).resolves.toBe(legacy);
    expect(mockNative.extractFromVideo.mock.calls[0]).toHaveLength(7);
});

test('pre-v2 native keeps its four-argument signature with shared sampling defaults', async () => {
    delete mockNative.apiVersion;
    await loadWrapper().extractFromVideo('clip');
    expect(mockNative.extractFromVideo).toHaveBeenCalledWith('clip', 240, 2, true);
});

test('native extraction is serialized across callers', async () => {
    const pending = deferred<ExtractResult>();
    mockNative.extractFromVideo.mockImplementationOnce(() => pending.promise);
    const { extractFromVideo } = loadWrapper();
    const first = extractFromVideo('first');
    const second = extractFromVideo('second');
    await Promise.resolve();
    expect(mockNative.extractFromVideo).toHaveBeenCalledTimes(1);
    pending.resolve(result);
    await Promise.all([first, second]);
    expect(mockNative.extractFromVideo.mock.calls.map((call) => call[0])).toEqual(['first', 'second']);
});

test('cancellation while queued skips native and lets the next caller proceed', async () => {
    const pending = deferred<ExtractResult>();
    mockNative.extractFromVideo.mockImplementationOnce(() => pending.promise);
    const { extractFromVideo } = loadWrapper();
    const first = extractFromVideo('first');
    const controller = new AbortController();
    const skipped = extractFromVideo('skip', { signal: controller.signal });
    const rejection = expect(skipped).rejects.toMatchObject({ name: 'AbortError' });
    const last = extractFromVideo('last');
    controller.abort();
    pending.resolve(result);
    await Promise.all([first, rejection, last]);
    expect(mockNative.extractFromVideo.mock.calls.map((call) => call[0])).toEqual(['first', 'last']);
});

test('in-flight cancellation waits for native before rejecting or releasing the lane', async () => {
    const pending = deferred<ExtractResult>();
    mockNative.extractFromVideo.mockImplementationOnce(() => pending.promise);
    const { extractFromVideo } = loadWrapper();
    const controller = new AbortController();
    let settled = false;
    const first = extractFromVideo('first', { signal: controller.signal }).catch((error: Error) => {
        settled = true;
        return error;
    });
    await Promise.resolve();
    controller.abort();
    const next = extractFromVideo('next');
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mockNative.extractFromVideo).toHaveBeenCalledTimes(1);
    pending.resolve(result);
    await expect(first).resolves.toMatchObject({ name: 'AbortError' });
    await next;
    expect(mockNative.extractFromVideo).toHaveBeenCalledTimes(2);
});

test('native errors release the lane for subsequent calls', async () => {
    mockNative.extractFromVideo.mockRejectedValueOnce(new Error('bad video'));
    const { extractFromVideo } = loadWrapper();
    const failed = expect(extractFromVideo('bad')).rejects.toThrow('bad video');
    const next = extractFromVideo('good');
    await failed;
    await expect(next).resolves.toBe(result);
});

test('already-aborted calls never enter native and AbortSignal never crosses the bridge', async () => {
    const controller = new AbortController();
    controller.abort();
    const { extractFromVideo } = loadWrapper();
    await expect(extractFromVideo('skip', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockNative.extractFromVideo).not.toHaveBeenCalled();
    await extractFromVideo('next', { signal: new AbortController().signal, transcribe: false });
    expect(mockNative.extractFromVideo).toHaveBeenCalledWith('next', 240, 2, false, 45000, 90000, 300);
});
