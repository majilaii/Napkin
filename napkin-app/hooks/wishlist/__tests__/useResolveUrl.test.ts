jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn(), isAuthFailure: jest.fn(() => false) }));
jest.mock('@/lib/instagramPerception', () => ({
    isInstagramUrl: (url: string) => url.includes('instagram.com'),
    fetchInstagramPerception: jest.fn(),
}));
jest.mock('@/lib/resolveTikTokVideo', () => ({ resolveTikTokVideo: jest.fn() }));

import { act, renderHook } from '@testing-library/react-native';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { fetchInstagramPerception } from '@/lib/instagramPerception';
import { resolveTikTokVideo } from '@/lib/resolveTikTokVideo';
import { useResolveUrl, type ResolveUrlData } from '../useResolveUrl';

const empty: ResolveUrlData = {
    source_type: 'video', candidates: [], best_query: null,
    note_prefill: '', partial_source: null, list_count_raw: null,
};

beforeEach(() => jest.resetAllMocks());

test('caption-only Instagram retains caption authority and the empty-result nudge fallback', async () => {
    jest.mocked(fetchInstagramPerception).mockResolvedValue({
        desc: 'Dinner at Lotta in Paris', text: 'Dinner at Lotta in Paris',
        transcript: '', hasTranscript: false,
    } as Awaited<ReturnType<typeof fetchInstagramPerception>>);
    jest.mocked(callEdgeFn).mockResolvedValueOnce(empty).mockResolvedValueOnce({ ...empty, ig_nudge: true });
    const { result } = renderHook(useResolveUrl);
    await act(async () => { await result.current.resolve('https://www.instagram.com/reel/example/'); });
    expect(callEdgeFn).toHaveBeenNthCalledWith(1, 'resolve-url', expect.objectContaining({
        body: { url: undefined, caption: 'Dinner at Lotta in Paris' },
    }));
    expect(callEdgeFn).toHaveBeenNthCalledWith(2, 'resolve-url', expect.objectContaining({
        body: { url: 'https://www.instagram.com/reel/example/' },
    }));
    expect(result.current.data?.ig_nudge).toBe(true);
});

test('unreadable TikTok delegates to the existing URL recovery route', async () => {
    jest.mocked(resolveTikTokVideo).mockResolvedValue(null);
    jest.mocked(callEdgeFn).mockResolvedValue(empty);
    const { result } = renderHook(useResolveUrl);
    await act(async () => { await result.current.resolve('https://vm.tiktok.com/ZN8YtVoyD/'); });
    expect(callEdgeFn).toHaveBeenCalledTimes(1);
    expect(callEdgeFn).toHaveBeenCalledWith('resolve-url', expect.objectContaining({
        body: { url: 'https://vm.tiktok.com/ZN8YtVoyD/' },
    }));
    expect(result.current.state).toBe('success');
});

test('usable video evidence yielding no venues is authoritative; no duplicate URL guess', async () => {
    jest.mocked(resolveTikTokVideo).mockResolvedValue(empty);
    const { result } = renderHook(useResolveUrl);
    await act(async () => { await result.current.resolve('https://vm.tiktok.com/ZN8YtVoyD/'); });
    expect(callEdgeFn).not.toHaveBeenCalled();
    expect(result.current.data).toEqual(empty);
});

test('cancelled TikTok completion cannot repaint the dismissed sheet', async () => {
    let finish!: (value: ResolveUrlData) => void;
    jest.mocked(resolveTikTokVideo).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(useResolveUrl);
    let pending!: Promise<void>;
    act(() => { pending = result.current.resolve('https://vm.tiktok.com/ZN8YtVoyD/'); });
    expect(result.current.state).toBe('loading');
    act(() => result.current.cancel());
    await act(async () => { finish(empty); await pending; });
    expect(result.current.state).toBe('idle');
    expect(result.current.data).toBeNull();
    expect(jest.mocked(resolveTikTokVideo).mock.calls[0][1].aborted).toBe(true);
});
