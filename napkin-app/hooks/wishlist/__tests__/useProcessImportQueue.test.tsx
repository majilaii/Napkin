/* eslint-disable import/first */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockStore = new Map<string, string>();
const mockExtract = jest.fn();
const mockPerceive = jest.fn();
const mockSlideDownload = jest.fn();
const mockSlideExtract = jest.fn();
const mockEdge = jest.fn();
const mockToast = jest.fn();
const mockLocalNotification = jest.fn();
const mockOfferNotifications = jest.fn();
const mockDelete = jest.fn();
const mockAppState = { currentState: 'active', addEventListener: () => ({ remove: jest.fn() }) };
const mockQueryClient = { invalidateQueries: jest.fn() };
const mockToastValue = { show: mockToast };
let mockSession = { user: { id: 'user-1' } };
let mockSourceExists = true;
let mockIntakeAvailable = false;
let mockPreparedListener: ((event: { jobId: string }) => void) | undefined;

jest.mock('react-native', () => ({ get AppState() { return mockAppState; }, Platform: { OS: 'ios' } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockQueryClient }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock('@/providers/ToastProvider', () => ({ useToast: () => mockToastValue }));
jest.mock('@/lib/track', () => ({ track: jest.fn() }));
jest.mock('@/lib/clientBuild', () => ({ clientBuildMetadata: () => ({}) }));
jest.mock('@/lib/tiktokPerception', () => ({
    ...jest.requireActual('@/lib/tiktokPerception'),
    fetchTikTokPerception: (...args: unknown[]) => mockPerceive(...args),
    downloadSlideImage: (...args: unknown[]) => mockSlideDownload(...args),
    deleteCachedSlide: jest.fn(),
}));
jest.mock('@/lib/edgeInvoke', () => ({
    callEdgeFn: (...args: unknown[]) => mockEdge(...args),
    isAuthFailure: () => false,
    SessionExpiredError: class extends Error {},
}));
jest.mock('@/lib/localNotify', () => ({
    presentImportNotification: (...args: unknown[]) => mockLocalNotification(...args),
    maybeOfferNotifPrompt: () => mockOfferNotifications(),
}));
jest.mock('@/modules/media-extract', () => ({
    isVideoImportAvailable: () => true,
    isBackgroundImportIntakeAvailable: () => mockIntakeAvailable,
    extractFromVideo: (...args: unknown[]) => mockExtract(...args),
    extractFromImages: (...args: unknown[]) => mockSlideExtract(...args),
    appGroupFileInfo: () => ({ exists: mockSourceExists, size: mockSourceExists ? 500 : 0 }),
    deleteAppGroupFile: (...args: unknown[]) => mockDelete(...args),
    beginBackgroundTask: () => 1,
    endBackgroundTask: jest.fn(),
    listImportManifests: () => [...mockStore.values()],
    writeImportManifest: (jobId: string, json: string) => { mockStore.set(jobId, json); return true; },
    removeImportManifest: (jobId: string) => { mockStore.delete(jobId); return true; },
    onVideoImportPrepared: (listener: (event: { jobId: string }) => void) => {
        mockPreparedListener = listener;
        return () => { mockPreparedListener = undefined; };
    },
}));

import { useProcessImportQueue } from '../useProcessImportQueue';
import { router } from 'expo-router';
import { getImport, pokeImportQueue, releaseDrainLock, type ImportManifest } from '@/lib/importQueue';

function Root({ showSheet = false }: { showSheet?: boolean }) {
    useProcessImportQueue();
    return showSheet ? React.createElement('sheet') : null;
}

const evidence = { ocr: ['Salvo Bakehouse Amsterdam'], transcript: '', durationSec: 10 };
const candidate = {
    candidate_id: 'candidate-1', restaurant_id: null, resolution_id: 'resolution-1', confidence: 'high',
    restaurant: { name: 'Salvo Bakehouse', city: 'Amsterdam', external_id: 'place-1' },
};
function seed(edits: Partial<ImportManifest> = {}) {
    const manifest: ImportManifest = {
        jobId: 'job-1', kind: 'video', videoPath: '/owned/video.mov', userId: 'user-1',
        importNonce: 'nonce-1', createdAt: 1, attempts: 0, status: 'pending', mode: 'review',
        protocolGeneration: 'v2', sourcePreparation: 'ready',
        destinations: { wishlist: true, listIds: [], newListTitles: [], tableId: null, tableIds: [] },
        ...edits,
    };
    mockStore.set(manifest.jobId, JSON.stringify(manifest));
}

describe('root import queue gallery integration', () => {
    let tree: any;
    let logSpy: jest.SpyInstance;
    beforeEach(() => {
        mockStore.clear();
        releaseDrainLock();
        mockSession = { user: { id: 'user-1' } };
        mockAppState.currentState = 'active';
        mockSourceExists = true;
        mockIntakeAvailable = false;
        mockExtract.mockReset().mockResolvedValue(evidence);
        mockPerceive.mockReset().mockResolvedValue(null);
        mockSlideDownload.mockReset().mockResolvedValue(null);
        mockSlideExtract.mockReset().mockResolvedValue({ ocr: [] });
        mockEdge.mockReset().mockImplementation(async (fn: string, options: any) => {
            if (fn === 'notifications') return { ok: true };
            if (fn === 'resolve-url' && !options.action) return { source_type: 'video', candidates: [candidate] };
            throw new Error(`Unexpected write ${fn}:${options.action}`);
        });
        mockLocalNotification.mockReset().mockResolvedValue(undefined);
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(async () => {
        if (tree) await act(async () => { tree.unmount(); });
        await flush();
        tree = undefined;
        logSpy.mockRestore();
    });

    async function flush() {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
    async function mount(showSheet = false) {
        await act(async () => { tree = TestRenderer.create(<Root showSheet={showSheet} />); });
        await flush();
    }

    it('a server-lane share is processed on this device at once and its server job dismissed (TICKET-248)', async () => {
        seed({ kind: 'url', url: 'https://www.tiktok.com/@chef/video/123', remoteJobId: 'job-1',
            videoPath: undefined, sourcePreparation: undefined });
        mockEdge.mockImplementation(async (fn: string, options: any) => {
            if (fn === 'notifications') return { ok: true };
            if (fn === 'background-imports' && options.action === 'dismiss') return { ok: true };
            if (fn === 'resolve-url' && !options.action) return { source_type: 'tiktok', candidates: [candidate] };
            throw new Error(`Unexpected request ${fn}:${options.action}`);
        });
        await mount();
        expect(getImport('job-1')).toMatchObject({ mode: 'review', remoteState: 'needs_device',
            spots: [expect.objectContaining({ resolution_id: 'resolution-1', restaurant_name: 'Salvo Bakehouse' })] });
        expect(mockPerceive).toHaveBeenCalled();
        const serverCalls = mockEdge.mock.calls.filter(([fn]) => fn === 'background-imports');
        expect(serverCalls).toHaveLength(1);
        expect(serverCalls[0][1]).toEqual(expect.objectContaining({ action: 'dismiss', body: {
            expected_owner_id: 'user-1', job_id: 'job-1', import_nonce: 'nonce-1',
            url: 'https://www.tiktok.com/@chef/video/123',
        } }));
        expect(getImport('job-1')?.remoteDismissed).toBe(true);
    });

    it('a failed server dismissal is retried by housekeeping until acknowledged (TICKET-248)', async () => {
        seed({ kind: 'url', url: 'https://www.tiktok.com/@chef/video/123', remoteJobId: 'job-1',
            videoPath: undefined, sourcePreparation: undefined });
        let dismissals = 0;
        let serverReachable = false;
        mockIntakeAvailable = true;
        mockEdge.mockImplementation(async (fn: string, options: any) => {
            if (fn === 'notifications') return { ok: true };
            if (fn === 'background-imports' && options.action === 'dismiss') {
                dismissals += 1;
                if (!serverReachable) throw new Error('offline');
                return { ok: true };
            }
            if (fn === 'resolve-url' && !options.action) return { source_type: 'tiktok', candidates: [candidate] };
            throw new Error(`Unexpected request ${fn}:${options.action}`);
        });
        await mount();
        // Local processing is never held back by the failed dismissal; the
        // drain's own housekeeping already tried again.
        expect(getImport('job-1')?.spots).toHaveLength(1);
        expect(dismissals).toBeGreaterThanOrEqual(2);
        expect(getImport('job-1')?.remoteDismissed).toBeUndefined();

        serverReachable = true;
        const before = dismissals;
        await act(async () => { pokeImportQueue(); });
        await flush();
        expect(dismissals).toBe(before + 1);
        expect(getImport('job-1')?.remoteDismissed).toBe(true);
        expect(getImport('job-1')?.mode).toBe('review');
    });

    it('a server that answers 5xx retries once, then fails visibly with try-again (TICKET-248)', async () => {
        seed({ kind: 'url', url: 'https://www.tiktok.com/@chef/video/123', videoPath: undefined, sourcePreparation: undefined });
        const timeout = Object.assign(new Error('Import extraction timed out'), { cause: { status: 503, code: 'TIMEOUT' } });
        mockEdge.mockImplementation(async (fn: string) => {
            if (fn === 'notifications') return { ok: true };
            if (fn === 'resolve-url') throw timeout;
            throw new Error(`Unexpected request ${fn}`);
        });
        await mount();
        expect(getImport('job-1')).toMatchObject({ status: 'pending', serverFailures: 1, attempts: 0 });
        expect(mockToast).not.toHaveBeenCalledWith("couldn't finish that import", expect.anything(), expect.anything());

        await act(async () => { pokeImportQueue(); });
        await flush();
        expect(getImport('job-1')).toMatchObject({ status: 'failed', serverFailures: 2 });
        expect(mockToast).toHaveBeenCalledWith("couldn't finish that import", expect.objectContaining({ label: 'View import' }),
            expect.anything());
    });

    it('a server failure after on-device reading resumes from the saved evidence, never re-reading (TICKET-248)', async () => {
        seed({ kind: 'url', url: 'https://www.tiktok.com/@chef/photo/123', videoPath: undefined, sourcePreparation: undefined });
        mockPerceive.mockResolvedValue({
            text: '', title: 'Amsterdam bakeries', desc: 'Best bakeries in Amsterdam', transcript: '', hasTranscript: false,
            isPhotoPost: true, playAddr: null, thumbnailUrl: 'https://cdn.example/thumb.jpg', authorHandle: 'chef',
            slideUrls: ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg'],
        });
        mockSlideDownload.mockResolvedValue('file://cache/slide.jpg');
        mockSlideExtract.mockResolvedValue({ ocr: ['SALVO BAKEHOUSE'] });
        const timeout = Object.assign(new Error('Import extraction timed out'), { cause: { status: 503, code: 'TIMEOUT' } });
        const bodies: any[] = [];
        mockEdge.mockImplementation(async (fn: string, options: any) => {
            if (fn === 'notifications') return { ok: true };
            if (fn !== 'resolve-url' || options.action) throw new Error(`Unexpected request ${fn}:${options.action}`);
            bodies.push(options.body);
            if (bodies.length === 1) throw timeout;
            return { source_type: 'video', candidates: [candidate] };
        });
        await mount();
        expect(getImport('job-1')).toMatchObject({ status: 'pending', serverFailures: 1,
            evidence: expect.objectContaining({ photoPost: true, handle: 'chef', escalationAddedEvidence: true }) });
        expect(mockSlideExtract).toHaveBeenCalledTimes(2);

        await act(async () => { pokeImportQueue(); });
        await flush();
        expect(mockPerceive).toHaveBeenCalledTimes(1);
        expect(mockSlideExtract).toHaveBeenCalledTimes(2);
        expect(bodies).toHaveLength(2);
        expect(bodies[1]).toEqual(bodies[0]);
        expect(bodies[1].extracted_text).toContain('SALVO BAKEHOUSE');
        expect(bodies[1].slide_count).toBe(2);
        const done = getImport('job-1');
        expect(done?.spots).toHaveLength(1);
        expect(done?.evidence).toBeUndefined();
        expect(done?.sourceHandle).toBe('chef');
    });

    it('a failed source fetch is never frozen into evidence; the next drain reads the source again (TICKET-248)', async () => {
        seed({ kind: 'url', url: 'https://www.tiktok.com/@chef/video/123', videoPath: undefined, sourcePreparation: undefined });
        mockPerceive.mockResolvedValueOnce(null).mockResolvedValue({
            text: 'Salvo Bakehouse Amsterdam', desc: 'Salvo Bakehouse Amsterdam', transcript: '', hasTranscript: false,
            isPhotoPost: false, playAddr: null, thumbnailUrl: null, authorHandle: 'chef',
        });
        const timeout = Object.assign(new Error('Import extraction timed out'), { cause: { status: 503, code: 'TIMEOUT' } });
        const bodies: any[] = [];
        mockEdge.mockImplementation(async (fn: string, options: any) => {
            if (fn === 'notifications') return { ok: true };
            if (fn !== 'resolve-url' || options.action) throw new Error(`Unexpected request ${fn}:${options.action}`);
            bodies.push(options.body);
            if (bodies.length === 1) throw timeout;
            return { source_type: 'video', candidates: [candidate] };
        });
        await mount();
        expect(getImport('job-1')).toMatchObject({ status: 'pending', serverFailures: 1 });
        expect(getImport('job-1')?.evidence).toBeUndefined();

        await act(async () => { pokeImportQueue(); });
        await flush();
        expect(mockPerceive).toHaveBeenCalledTimes(2);
        expect(bodies.slice(1).some((body) => body.caption === 'Salvo Bakehouse Amsterdam')).toBe(true);
        expect(getImport('job-1')?.spots).toHaveLength(1);
    });

    it('rate limits and lost connections keep waiting without counting a failure', async () => {
        seed({ kind: 'url', url: 'https://www.tiktok.com/@chef/video/123', videoPath: undefined, sourcePreparation: undefined });
        const limited = Object.assign(new Error('Too many'), { cause: { status: 429 } });
        mockEdge.mockImplementation(async (fn: string) => {
            if (fn === 'resolve-url') throw limited;
            return { ok: true };
        });
        await mount();
        expect(getImport('job-1')).toMatchObject({ status: 'pending', attempts: 0 });
        expect(getImport('job-1')?.serverFailures).toBeUndefined();
    });

    it.each(['no slide URLs', 'failed downloads', 'failed OCR'] as const)(
        'preserves photo title when %s and never retries generic URL after abstention', async failure => {
            seed({ kind: 'url', url: 'https://vm.tiktok.com/ZN8jyna5p/', videoPath: undefined });
            mockPerceive.mockResolvedValue({
                text: '', title: 'Keiko Uchida', desc: 'A little corner of Japan in London',
                transcript: '', hasTranscript: false, isPhotoPost: true,
                playAddr: null, thumbnailUrl: null, authorHandle: 'allisims',
                slideUrls: failure === 'no slide URLs' ? [] : ['https://cdn.example/1.jpg'],
            });
            if (failure === 'failed OCR') {
                mockSlideDownload.mockResolvedValue('file://cache/slide.jpg');
                mockSlideExtract.mockRejectedValue(new Error('OCR unavailable'));
            }
            mockEdge.mockImplementation(async (fn: string) => fn === 'notifications'
                ? { ok: true } : { source_type: 'video', candidates: [] });
            await mount();
            const calls = mockEdge.mock.calls.filter(([fn]) => fn === 'resolve-url');
            expect(calls).toHaveLength(1);
            const body = calls[0][1].body;
            expect(body.extracted_text).toContain('[title]\nKeiko Uchida');
            expect(body.extracted_text.match(/A little corner of Japan in London/g)).toHaveLength(1);
            expect(body.caption).toBeUndefined();
            expect(body.url).toBeUndefined();
            expect(body.slide_count).toBe(failure === 'no slide URLs' ? undefined : 1);
            expect(mockExtract).not.toHaveBeenCalled();
        },
    );

    it('waits for native preparation and drains from its event after the import sheet unmounts', async () => {
        seed({ sourcePreparation: 'pending' });
        await mount(true);
        expect(mockExtract).not.toHaveBeenCalled();
        expect(mockEdge).not.toHaveBeenCalled();
        await act(async () => { tree.update(<Root showSheet={false} />); });
        seed({ sourcePreparation: 'ready' });
        await act(async () => { mockPreparedListener?.({ jobId: 'job-1' }); });
        await flush();
        expect(mockExtract).toHaveBeenCalledWith('/owned/video.mov');
        expect(getImport('job-1')).toMatchObject({ mode: 'review', notificationOutcome: 'review', spots: [expect.objectContaining({ restaurant_name: 'Salvo Bakehouse' })] });
        expect(mockEdge).not.toHaveBeenCalledWith('resolve-url', expect.objectContaining({ action: 'save_spots' }));
        const reviewAction = mockToast.mock.calls.find(([copy]) => copy === '1 spot ready to review')?.[1];
        expect(reviewAction).toBeDefined();
        reviewAction.onPress();
        expect(router.push).toHaveBeenCalledWith('/import-progress?openJob=job-1&outcome=review&owner=user-1');
        expect(mockOfferNotifications).not.toHaveBeenCalled(); // gallery asks after tray dismissal
        expect(mockEdge).toHaveBeenCalledWith('notifications', expect.objectContaining({ body: expect.objectContaining({ expected_owner_id: 'user-1' }) }));
    });

    it.each(['empty perception', 'zero matches'] as const)('retains a durable failed row and its video for %s', async (failure) => {
        seed();
        if (failure === 'empty perception') mockExtract.mockResolvedValue({ ocr: [], transcript: '', durationSec: 10 });
        else mockEdge.mockImplementation(async (fn: string) => fn === 'notifications' ? { ok: true } : { source_type: 'video', candidates: [] });
        await mount();
        expect(getImport('job-1')).toMatchObject({ status: 'failed', videoPath: '/owned/video.mov', notificationOutcome: 'failed' });
        expect(mockDelete).not.toHaveBeenCalled();
        expect(mockEdge).toHaveBeenCalledWith('notifications', expect.objectContaining({ body: expect.objectContaining({ subject_meta: expect.objectContaining({ outcome: 'failed' }) }) }));
    });

    it('announces native preparation failure from the prepared event without starting OCR', async () => {
        seed({ sourcePreparation: 'pending' });
        await mount();
        seed({ sourcePreparation: 'failed', status: 'failed' });
        await act(async () => { mockPreparedListener?.({ jobId: 'job-1' }); });
        await flush();
        expect(mockExtract).not.toHaveBeenCalled();
        expect(getImport('job-1')).toMatchObject({ sourcePreparation: 'failed', notificationOutcome: 'failed' });
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it('requires choosing another video when a durable source file is missing', async () => {
        seed();
        mockSourceExists = false;
        await mount();
        expect(mockExtract).not.toHaveBeenCalled();
        expect(getImport('job-1')).toMatchObject({ status: 'failed', sourcePreparation: 'failed', videoPath: '/owned/video.mov' });
    });

    it('retries a failed inbox write without repeating perception or the local completion alert', async () => {
        seed();
        mockAppState.currentState = 'background';
        let inboxWorks = false;
        mockEdge.mockImplementation(async (fn: string) => {
            if (fn === 'notifications') {
                if (!inboxWorks) throw new Error('temporary inbox failure');
                return { ok: true };
            }
            return { source_type: 'video', candidates: [candidate] };
        });
        await mount();
        expect(getImport('job-1')).toMatchObject({ notificationOutcome: 'pending', localNotificationOutcome: 'review' });
        expect(mockLocalNotification).toHaveBeenCalledTimes(1);
        inboxWorks = true;
        await act(async () => { pokeImportQueue(); });
        await flush();
        expect(getImport('job-1')?.notificationOutcome).toBe('review');
        expect(mockLocalNotification).toHaveBeenCalledTimes(1);
        expect(mockExtract).toHaveBeenCalledTimes(1);
    });

    it('keeps legacy held reviews quiet when the new processor mounts', async () => {
        seed({ sourcePreparation: undefined, spots: [{ candidate_id: 'old', client_nonce: 'old-nonce', restaurant_id: null,
            external_id: null, restaurant_name: 'Old review', restaurant_city: null, table_id: null, table_client_nonce: null, place: null }] });
        await mount();
        expect(mockEdge).not.toHaveBeenCalled();
        expect(mockToast).not.toHaveBeenCalled();
    });

    it('processes new imports before bounded offline failure replays and rotates the next batch', async () => {
        for (let n = 1; n <= 5; n++) seed({ jobId: `failed-${n}`, status: 'failed', notificationOutcome: 'pending' });
        seed();
        const events: string[] = [];
        mockExtract.mockImplementation(async () => { events.push('extract'); return evidence; });
        mockEdge.mockImplementation(async (fn: string, options: any) => {
            if (fn !== 'notifications') return { source_type: 'video', candidates: [candidate] };
            const { job_id, outcome } = options.body.subject_meta;
            if (outcome === 'failed') {
                events.push(job_id);
                throw new Error('inbox offline');
            }
            return { ok: true };
        });
        await mount();
        expect(events).toEqual(['extract', 'failed-1', 'failed-2', 'failed-3']);
        expect(getImport('job-1')?.notificationOutcome).toBe('review');
        await act(async () => { pokeImportQueue(); });
        await flush();
        expect(events).toEqual(['extract', 'failed-1', 'failed-2', 'failed-3', 'failed-4', 'failed-5', 'failed-1']);
        expect(mockToast.mock.calls.filter(([copy]) => copy === "couldn't import that video")).toHaveLength(5);
    });

    it('yields failure replay to an import accepted while an inbox request is in flight', async () => {
        seed({ jobId: 'failed-1', status: 'failed', notificationOutcome: 'pending' });
        seed({ jobId: 'failed-2', status: 'failed', notificationOutcome: 'pending' });
        const events: string[] = [];
        let finishReplay!: (result: { ok: boolean }) => void;
        mockExtract.mockImplementation(async () => { events.push('extract'); return evidence; });
        mockEdge.mockImplementation(async (fn: string, options: any) => {
            if (fn !== 'notifications') return { source_type: 'video', candidates: [candidate] };
            const { job_id, outcome } = options.body.subject_meta;
            if (outcome === 'failed') events.push(job_id);
            if (job_id === 'failed-1') return new Promise((resolve) => { finishReplay = resolve; });
            return { ok: true };
        });
        await mount();
        expect(events).toEqual(['failed-1']);
        seed();
        await act(async () => { pokeImportQueue(); });
        await act(async () => { finishReplay({ ok: true }); });
        await flush();
        expect(events).toEqual(['failed-1', 'extract', 'failed-2']);
        expect(getImport('job-1')?.notificationOutcome).toBe('review');
    });

    it.each([
        ['video', "couldn't import that video"],
        ['url', "couldn't finish that import"],
    ] as const)('uses source-appropriate copy for a replayed %s failure', async (kind, title) => {
        seed({ kind, url: kind === 'url' ? 'https://example.com/places' : undefined,
            sourcePreparation: undefined, status: 'failed', notificationOutcome: 'pending' });
        mockAppState.currentState = 'background';
        await mount();
        expect(mockLocalNotification).toHaveBeenCalledWith({ title, body: 'Open Napkin to try again', url: '/import-progress?openJob=job-1&outcome=failed&owner=user-1' });
        expect(getImport('job-1')?.notificationOutcome).toBe('failed');
    });

    it('releases the drain for a new import when the prior inbox request never settles', async () => {
        jest.useFakeTimers();
        try {
            seed({ jobId: 'failed-1', status: 'failed', notificationOutcome: 'pending' });
            let firstReplay = true;
            mockEdge.mockImplementation(async (fn: string, options: any) => {
                if (fn !== 'notifications') return { source_type: 'video', candidates: [candidate] };
                if (options.body.subject_meta.outcome === 'failed' && firstReplay) {
                    firstReplay = false;
                    return new Promise(() => {});
                }
                return { ok: true };
            });
            await act(async () => { tree = TestRenderer.create(<Root />); });
            const firstSignal = mockEdge.mock.calls[0][1].signal as AbortSignal;
            seed();
            await act(async () => { pokeImportQueue(); });
            expect(mockExtract).not.toHaveBeenCalled();
            await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
            expect(firstSignal.aborted).toBe(true);
            expect(getImport('failed-1')?.notificationOutcome).toBe('pending');
            await act(async () => { await jest.advanceTimersByTimeAsync(1); });
            expect(mockExtract).toHaveBeenCalledTimes(1);
            expect(getImport('job-1')?.notificationOutcome).toBe('review');
            await act(async () => { await jest.runOnlyPendingTimersAsync(); });
            expect(getImport('failed-1')?.notificationOutcome).toBe('failed');
        } finally {
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    it('stops replay and leaves delivery pending when the owner changes during an inbox request', async () => {
        seed({ jobId: 'failed-1', status: 'failed', notificationOutcome: 'pending' });
        seed({ jobId: 'failed-2', status: 'failed', notificationOutcome: 'pending' });
        let finishReplay!: (result: { ok: boolean }) => void;
        mockEdge.mockReturnValue(new Promise((resolve) => { finishReplay = resolve; }));
        await mount();
        mockSession = { user: { id: 'user-2' } };
        await act(async () => { tree.update(<Root />); });
        await act(async () => { finishReplay({ ok: true }); });
        await flush();
        expect(mockEdge).toHaveBeenCalledTimes(1);
        expect(mockEdge).toHaveBeenCalledWith('notifications', expect.objectContaining({
            body: expect.objectContaining({ expected_owner_id: 'user-1' }),
        }));
        expect(getImport('failed-1')?.notificationOutcome).toBe('pending');
        expect(getImport('failed-2')?.notificationOutcome).toBe('pending');
    });

    it('does not resolve or notify an old owner after the account changes during OCR', async () => {
        seed();
        let finish!: (result: typeof evidence) => void;
        mockExtract.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        await mount();
        mockSession = { user: { id: 'user-2' } };
        await act(async () => { tree.update(<Root />); });
        await act(async () => { finish(evidence); });
        await flush();
        expect(mockEdge).not.toHaveBeenCalled();
        expect(getImport('job-1')?.userId).toBe('user-1');
        expect(mockDelete).not.toHaveBeenCalled();
    });
});
