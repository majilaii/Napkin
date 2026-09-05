import { resolveTikTokVideo, type TikTokResolveDependencies } from '../resolveTikTokVideo';
import type { TikTokPerception } from '../tiktokPerception';
import type { ResolveUrlData } from '@/hooks/wishlist/useResolveUrl';
import type { ExtractResult } from '@/modules/media-extract/src/MediaExtract.types';

const url = 'https://www.tiktok.com/@creator/video/123';
const file = 'file://cache/tiktok.mp4';

function page(overrides: Partial<TikTokPerception> = {}): TikTokPerception {
    return {
        text: 'A lovely dinner in Paris', desc: 'A lovely dinner in Paris',
        transcript: '', hasTranscript: false, isPhotoPost: false,
        playAddr: 'https://signed.example/video.mp4', thumbnailUrl: null,
        authorHandle: 'creator', ...overrides,
    };
}

function resolved(name = 'LOTTA'): ResolveUrlData {
    return {
        source_type: 'video', best_query: null, note_prefill: '', partial_source: null,
        list_count_raw: null,
        candidates: [{
            confidence: 'high', stance: 'recommended', restaurant_id: null,
            google_place_id: 'place-lotta', already_wishlisted: false,
            restaurant: {
                id: '', name, external_id: 'place-lotta', city: 'Paris',
                formattedAddress: 'Paris, France', country: 'France', latitude: 48.85,
                longitude: 2.35, categories: [], cuisine: null, googleRating: null,
                googleRatingCount: null, priceLevel: null, photoReference: null,
                website: null, link: null,
            },
        }],
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const emptyVideo: ExtractResult = { ocr: [], transcript: '', durationSec: 15.76 };
const tailVideo: ExtractResult = {
    ...emptyVideo, ocr: ['ABATILLES', 'LOTTA'],
    frames: [{ timeSec: 2, lines: ['ABATILLES'] }, { timeSec: 15.5, lines: ['LOTTA'] }],
};

function setup(perception: TikTokPerception | null = page()) {
    const controller = new AbortController();
    const deps: jest.Mocked<TikTokResolveDependencies> = {
        perceive: jest.fn().mockResolvedValue(perception),
        download: jest.fn().mockResolvedValue(file),
        extract: jest.fn().mockResolvedValue(tailVideo),
        remove: jest.fn().mockResolvedValue(undefined),
        resolve: jest.fn().mockResolvedValue(resolved()),
        available: jest.fn().mockReturnValue(true),
        isAuthFailure: jest.fn().mockReturnValue(false),
    };
    return { deps, controller, run: (caption?: string) => resolveTikTokVideo(url, controller.signal, deps, caption) };
}

async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(1000); });
afterEach(() => { jest.restoreAllMocks(); });

test('caption-corroborated single venue earns the fast path without download', async () => {
    const { deps, run } = setup(page({ desc: 'Dinner at Lótta in Paris' }));
    const result = await run();
    expect(result?.candidates[0].restaurant.name).toBe('LOTTA');
    expect(deps.resolve).toHaveBeenCalledTimes(1);
    expect(deps.resolve.mock.calls[0][0]).toEqual({ caption: 'Dinner at Lótta in Paris' });
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
});

test('nameless caption and a high-confidence bottle guess escalate to timestamped ending OCR', async () => {
    const { deps, controller, run } = setup();
    deps.resolve.mockResolvedValueOnce(resolved('Abatilles')).mockResolvedValueOnce(resolved());
    expect((await run())?.candidates[0].restaurant.name).toBe('LOTTA');
    expect(deps.resolve).toHaveBeenCalledTimes(2);
    expect(deps.resolve.mock.calls[1][0]).toEqual({
        caption: 'A lovely dinner in Paris',
        extracted_text: '[on-screen text]\n[frame 2.0s]\nABATILLES\n[frame 15.5s; ending]\nLOTTA',
    });
    expect(deps.extract).toHaveBeenCalledWith(file, {
        signal: controller.signal, transcribe: true, ocrBudgetMs: 45000, sttTimeoutMs: 30000,
    });
    expect(deps.remove).toHaveBeenCalledWith(file);
});

test('a caption-free silent video resolves only the OCR body, with no empty caption', async () => {
    const { deps, run } = setup(page({ desc: '', text: '' }));
    await run();
    expect(deps.resolve).toHaveBeenCalledTimes(1);
    expect(deps.resolve.mock.calls[0][0]).not.toHaveProperty('caption');
    expect(deps.resolve.mock.calls[0][0].extracted_text).toContain('LOTTA');
});

test('caption-free ASR guesses still escalate and platform speech suppresses redundant native STT', async () => {
    const { deps, run } = setup(page({ desc: '', transcript: 'We love Abatilles', hasTranscript: true }));
    deps.resolve.mockResolvedValueOnce(resolved('Abatilles')).mockResolvedValueOnce(resolved());
    await run();
    expect(deps.extract.mock.calls[0][1].transcribe).toBe(false);
    expect(deps.resolve.mock.calls[0][0]).toEqual({ extracted_text: '[spoken words]\nWe love Abatilles' });
    expect(deps.resolve.mock.calls[1][0].extracted_text).toContain('[spoken words]\nWe love Abatilles');
});

test.each([null, page({ isPhotoPost: true })])('unavailable or photo-mode perception retains the fallback route (%p)', async perception => {
    const { deps, run } = setup(perception);
    await expect(run()).resolves.toBeNull();
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
});

test('unavailable native extraction preserves the cheap result without downloading', async () => {
    const { deps, run } = setup();
    deps.available.mockReturnValue(false);
    await expect(run()).resolves.toMatchObject({ candidates: [{ restaurant: { name: 'LOTTA' } }] });
    expect(deps.download).not.toHaveBeenCalled();
});

test('unavailable native and no text return null without an empty resolve request', async () => {
    const { deps, run } = setup(page({ desc: '', transcript: '' }));
    deps.available.mockReturnValue(false);
    await expect(run()).resolves.toBeNull();
    expect(deps.resolve).not.toHaveBeenCalled();
});

test('empty OCR does not duplicate unchanged caption/ASR resolution', async () => {
    const { deps, run } = setup(page({ transcript: 'Dinner in Paris' }));
    deps.extract.mockResolvedValue(emptyVideo);
    await run();
    expect(deps.resolve).toHaveBeenCalledTimes(1);
    expect(deps.remove).toHaveBeenCalledWith(file);
});

test('all-empty perception and extraction return null and clean the downloaded file', async () => {
    const { deps, run } = setup(page({ desc: '', transcript: '' }));
    deps.extract.mockResolvedValue(emptyVideo);
    await expect(run()).resolves.toBeNull();
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.remove).toHaveBeenCalledWith(file);
});

test('timestamped v4 evidence is used even if legacy OCR is empty', async () => {
    const { deps, run } = setup();
    deps.extract.mockResolvedValue({ ...tailVideo, ocr: [] });
    await run();
    expect(deps.resolve).toHaveBeenCalledTimes(2);
    expect(deps.resolve.mock.calls[1][0].extracted_text).toContain('LOTTA');
});

test('native extraction failure falls back to existing text and always cleans the file', async () => {
    const { deps, run } = setup();
    deps.extract.mockRejectedValue(new Error('Cannot decode video'));
    await expect(run()).resolves.toMatchObject({ candidates: [{ restaurant: { name: 'LOTTA' } }] });
    expect(deps.resolve).toHaveBeenCalledTimes(1);
    expect(deps.remove).toHaveBeenCalledWith(file);
});

test('download retry and perception refresh share the original 30-second deadline', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { deps, controller, run } = setup();
    deps.download.mockImplementationOnce(async () => { now += 7000; return null; });
    deps.perceive.mockImplementationOnce(async () => page()).mockImplementationOnce(async () => { now += 13000; return page(); });
    await run();
    expect(deps.perceive.mock.calls).toEqual([[url], [url, 31000]]);
    expect(deps.download.mock.calls.map(call => call[2])).toEqual([30000, 10000]);
    expect(deps.download.mock.calls[1][3]).toBe(controller.signal);
});

test('an exhausted download budget permits no refresh or retry', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { deps, run } = setup();
    deps.download.mockImplementation(async () => { now += 30000; return null; });
    await run();
    expect(deps.perceive).toHaveBeenCalledTimes(1);
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(deps.extract).not.toHaveBeenCalled();
});

test('refreshed caption survives unavailable video downloads', async () => {
    const { deps, run } = setup();
    deps.download.mockResolvedValue(null);
    deps.perceive.mockResolvedValueOnce(page()).mockResolvedValueOnce(page({ desc: 'Dinner at LOTTA, Paris' }));
    await run();
    expect(deps.resolve).toHaveBeenCalledTimes(2);
    expect(deps.resolve.mock.calls[1][0]).toEqual({ caption: 'Dinner at LOTTA, Paris' });
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
});

test('new platform ASR is resolved when neither perception page exposes a video address', async () => {
    const { deps, run } = setup(page({ desc: '', playAddr: null }));
    deps.perceive.mockResolvedValueOnce(page({ desc: '', playAddr: null }))
        .mockResolvedValueOnce(page({ desc: '', playAddr: null, transcript: 'I recommend LOTTA' }));
    await run();
    expect(deps.resolve).toHaveBeenCalledTimes(1);
    expect(deps.resolve.mock.calls[0][0]).toEqual({ extracted_text: '[spoken words]\nI recommend LOTTA' });
    expect(deps.download).not.toHaveBeenCalled();
});

test('a refresh consuming the remaining deadline still contributes its recovered caption', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { deps, run } = setup();
    deps.download.mockResolvedValue(null);
    deps.perceive.mockResolvedValueOnce(page()).mockImplementationOnce(async () => {
        now += 30000; return page({ desc: 'LOTTA in Paris' });
    });
    await run();
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(deps.resolve.mock.calls[1][0]).toEqual({ caption: 'LOTTA in Paris' });
});

test('refreshed caption is retained when the retry downloads but OCR is empty', async () => {
    const { deps, run } = setup();
    deps.download.mockResolvedValueOnce(null).mockResolvedValueOnce(file);
    deps.perceive.mockResolvedValueOnce(page()).mockResolvedValueOnce(page({ desc: 'LOTTA in Paris' }));
    deps.extract.mockResolvedValue(emptyVideo);
    await run();
    expect(deps.resolve).toHaveBeenCalledTimes(2);
    expect(deps.resolve.mock.calls[1][0]).toEqual({ caption: 'LOTTA in Paris' });
    expect(deps.remove).toHaveBeenCalledWith(file);
});

test('refreshed ASR survives extraction failure while a missing refreshed caption preserves the initial caption', async () => {
    const { deps, run } = setup();
    deps.download.mockResolvedValueOnce(null).mockResolvedValueOnce(file);
    deps.perceive.mockResolvedValueOnce(page()).mockResolvedValueOnce(page({ desc: '', transcript: 'I loved LOTTA' }));
    deps.extract.mockRejectedValue(new Error('Bad video'));
    await run();
    expect(deps.resolve.mock.calls[1][0]).toEqual({
        caption: 'A lovely dinner in Paris', extracted_text: '[spoken words]\nI loved LOTTA',
    });
    expect(deps.remove).toHaveBeenCalledWith(file);
});

test('unchanged failed downloads do not repeat the same paid text resolve', async () => {
    const { deps, run } = setup();
    deps.download.mockResolvedValue(null);
    await run();
    expect(deps.download).toHaveBeenCalledTimes(2);
    expect(deps.resolve).toHaveBeenCalledTimes(1);
});

test('an explicit caption override is retained over refreshed provider captions', async () => {
    const { deps, run } = setup();
    deps.download.mockResolvedValueOnce(null).mockResolvedValueOnce(file);
    deps.perceive.mockResolvedValueOnce(page()).mockResolvedValueOnce(page({ desc: 'Different provider caption' }));
    await run('My own dinner caption');
    expect(deps.resolve.mock.calls.map(call => call[0].caption)).toEqual(['My own dinner caption', 'My own dinner caption']);
});

test('already-aborted calls perform no perception or network work', async () => {
    const { deps, controller, run } = setup();
    controller.abort();
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.perceive).not.toHaveBeenCalled();
});

test('cancellation after perception prevents stale cheap resolution', async () => {
    const { deps, controller, run } = setup();
    deps.perceive.mockImplementation(async () => { controller.abort(); return page(); });
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.resolve).not.toHaveBeenCalled();
});

test('cancellation after the cheap resolve prevents escalation and stale success', async () => {
    const { deps, controller, run } = setup();
    deps.resolve.mockImplementation(async () => { controller.abort(); return resolved(); });
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.download).not.toHaveBeenCalled();
});

test('cancellation when a download finishes cleans its returned file before skipping OCR', async () => {
    const { deps, controller, run } = setup();
    deps.download.mockImplementation(async () => { controller.abort(); return file; });
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.remove).toHaveBeenCalledWith(file);
});

test('cancellation during a failed download prevents refresh', async () => {
    const { deps, controller, run } = setup();
    deps.download.mockImplementation(async () => { controller.abort(); return null; });
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.perceive).toHaveBeenCalledTimes(1);
});

test('cancellation during perception refresh prevents another download', async () => {
    const { deps, controller, run } = setup();
    deps.download.mockResolvedValue(null);
    deps.perceive.mockResolvedValueOnce(page()).mockImplementationOnce(async () => { controller.abort(); return page(); });
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.download).toHaveBeenCalledTimes(1);
});

test('cancellation during native OCR waits for native settlement before deleting its file', async () => {
    const pending = deferred<ExtractResult>();
    const { deps, controller, run } = setup();
    deps.extract.mockReturnValue(pending.promise);
    const running = run();
    const rejection = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(deps.extract).toHaveBeenCalled();
    controller.abort();
    await flush();
    expect(deps.remove).not.toHaveBeenCalled();
    pending.resolve(tailVideo);
    await rejection;
    expect(deps.remove).toHaveBeenCalledWith(file);
    expect(deps.resolve).toHaveBeenCalledTimes(1);
});

test('a late fused response after cancellation cannot escape as a successful import', async () => {
    const pending = deferred<ResolveUrlData>();
    const { deps, controller, run } = setup();
    deps.resolve.mockResolvedValueOnce(resolved('Abatilles')).mockReturnValueOnce(pending.promise);
    const running = run();
    const rejection = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(deps.resolve).toHaveBeenCalledTimes(2);
    controller.abort();
    pending.resolve(resolved());
    await rejection;
    expect(deps.remove).toHaveBeenCalledWith(file);
});

test('fused resolver failures still clean the downloaded file', async () => {
    const { deps, run } = setup();
    deps.resolve.mockResolvedValueOnce(resolved()).mockRejectedValueOnce(new Error('Resolver unavailable'));
    await expect(run()).rejects.toThrow('Resolver unavailable');
    expect(deps.remove).toHaveBeenCalledWith(file);
});

test('a deterministic cheap extraction failure escalates when native OCR adds evidence', async () => {
    const failure = Object.assign(new Error('Could not extract caption'), { cause: { status: 422 } });
    const { deps, run } = setup();
    deps.resolve.mockRejectedValueOnce(failure).mockResolvedValueOnce(resolved());
    await expect(run()).resolves.toMatchObject({ candidates: [{ restaurant: { name: 'LOTTA' } }] });
    expect(deps.extract).toHaveBeenCalledTimes(1);
    expect(deps.resolve).toHaveBeenCalledTimes(2);
    expect(deps.resolve.mock.calls[1][0].extracted_text).toContain('LOTTA');
    expect(deps.remove).toHaveBeenCalledWith(file);
});

test.each(['empty_ocr', 'failed_download', 'missing_native'])('an unchanged failed cheap body rethrows its original error without rebilling (%s)', async situation => {
    const failure = Object.assign(new Error('Could not extract caption'), { cause: { status: 422 } });
    const { deps, run } = setup();
    deps.resolve.mockRejectedValue(failure);
    if (situation === 'empty_ocr') deps.extract.mockResolvedValue(emptyVideo);
    if (situation === 'failed_download') deps.download.mockResolvedValue(null);
    if (situation === 'missing_native') deps.available.mockReturnValue(false);
    await expect(run()).rejects.toBe(failure);
    expect(deps.resolve).toHaveBeenCalledTimes(1);
    if (situation === 'empty_ocr') expect(deps.remove).toHaveBeenCalledWith(file);
});

test('a deterministic cheap failure can recover from refreshed text even when the video remains unavailable', async () => {
    const failure = Object.assign(new Error('Could not extract caption'), { cause: { status: 422 } });
    const { deps, run } = setup();
    deps.resolve.mockRejectedValueOnce(failure).mockResolvedValueOnce(resolved());
    deps.download.mockResolvedValue(null);
    deps.perceive.mockResolvedValueOnce(page()).mockResolvedValueOnce(page({ desc: 'LOTTA in Paris' }));
    await expect(run()).resolves.toMatchObject({ candidates: [{ restaurant: { name: 'LOTTA' } }] });
    expect(deps.resolve).toHaveBeenCalledTimes(2);
    expect(deps.resolve.mock.calls[1][0]).toEqual({ caption: 'LOTTA in Paris' });
});

test.each([401, 403, 408, 429, 500, 503])('auth and transient cheap errors stop the ladder instead of spending more API calls (%i)', async status => {
    const failure = Object.assign(new Error('Resolve failed'), { cause: { status } });
    const { deps, run } = setup();
    deps.resolve.mockRejectedValue(failure);
    await expect(run()).rejects.toBe(failure);
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
});

test.each([
    Object.assign(new Error('Signed out'), { code: 'session_expired' }),
    Object.assign(new Error('Offline'), { cause: { code: 'NETWORK' } }),
    Object.assign(new Error('Cancelled'), { name: 'AbortError' }),
])('session, offline and cancellation errors stop before download (%p)', async failure => {
    const { deps, run } = setup();
    deps.resolve.mockRejectedValue(failure);
    await expect(run()).rejects.toBe(failure);
    expect(deps.download).not.toHaveBeenCalled();
});

test('the injected transport auth predicate recognizes JWT errors without a status', async () => {
    const failure = new Error('Invalid JWT');
    const { deps, run } = setup();
    deps.resolve.mockRejectedValue(failure);
    deps.isAuthFailure = jest.fn().mockReturnValue(true);
    await expect(run()).rejects.toBe(failure);
    expect(deps.download).not.toHaveBeenCalled();
});

test.each(['missing_native', 'failed_download', 'empty_ocr', 'failed_ocr'])('zero cheap candidates without usable video preserve the old URL/thumbnail fallback (%s)', async situation => {
    const { deps, run } = setup();
    deps.resolve.mockResolvedValue({ ...resolved(), candidates: [] });
    if (situation === 'missing_native') deps.available.mockReturnValue(false);
    if (situation === 'failed_download') deps.download.mockResolvedValue(null);
    if (situation === 'empty_ocr') deps.extract.mockResolvedValue(emptyVideo);
    if (situation === 'failed_ocr') deps.extract.mockRejectedValue(new Error('Cannot read clip'));
    await expect(run()).resolves.toBeNull();
    expect(deps.resolve).toHaveBeenCalledTimes(1);
});

test('zero candidates from usable video evidence remain authoritative rather than returning the URL fallback sentinel', async () => {
    const empty = { ...resolved(), candidates: [] };
    const { deps, run } = setup();
    deps.resolve.mockResolvedValue(empty);
    await expect(run()).resolves.toBe(empty);
    expect(deps.resolve).toHaveBeenCalledTimes(2);
    expect(deps.resolve.mock.calls[1][0].extracted_text).toContain('LOTTA');
});
