/* eslint-disable import/first */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockStore = new Map<string, string>();
const mockExtract = jest.fn();
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
let mockPreparedListener: ((event: { jobId: string }) => void) | undefined;

jest.mock('react-native', () => ({ get AppState() { return mockAppState; }, Platform: { OS: 'ios' } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockQueryClient }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock('@/providers/ToastProvider', () => ({ useToast: () => mockToastValue }));
jest.mock('@/lib/track', () => ({ track: jest.fn() }));
jest.mock('@/lib/clientBuild', () => ({ clientBuildMetadata: () => ({}) }));
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
    extractFromVideo: (...args: unknown[]) => mockExtract(...args),
    extractFromImages: jest.fn(),
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
        mockExtract.mockReset().mockResolvedValue(evidence);
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
