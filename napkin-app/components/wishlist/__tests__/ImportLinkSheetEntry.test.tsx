/* eslint-disable import/first */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPick = jest.fn();
const mockExtract = jest.fn();
const mockUpload = jest.fn();
const mockResolve = jest.fn();
const mockCancel = jest.fn();
const mockRequestLocation = jest.fn();
const mockQueueVideo = jest.fn();
const mockNativePick = jest.fn();
const mockToast = jest.fn();
const mockOfferNotifications = jest.fn();
let mockBackgroundCapture = false;
let mockUserId = 'owner-1';
// TICKET-250: most tests model a user who already allowed AI imports.
const mockRequestAiConsent = jest.fn();

jest.mock('react-native', () => ({
    Modal: 'Modal', View: 'View', Text: 'Text', TextInput: 'TextInput',
    Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    Keyboard: { dismiss: jest.fn() },
    StyleSheet: { create: (styles: unknown) => styles },
    Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
}));
jest.mock('react-native-reanimated', () => ({ ScrollView: 'Animated.ScrollView' }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'GestureHandlerRootView' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockGetString = jest.fn(async () => '');
let mockPasteButtonAvailable = true;
jest.mock('expo-clipboard', () => ({
    hasStringAsync: jest.fn(async () => false),
    getStringAsync: () => mockGetString(),
    get isPasteButtonAvailable() { return mockPasteButtonAvailable; },
    ClipboardPasteButton: 'ClipboardPasteButton',
}));
jest.mock('expo-image-picker', () => ({
    MediaTypeOptions: { Images: 'Images', Videos: 'Videos' },
    launchImageLibraryAsync: (...args: unknown[]) => mockPick(...args),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/useNearbyLocation', () => ({
    useNearbyLocation: () => ({ coords: null, requestIfGranted: mockRequestLocation }),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/providers/ToastProvider', () => ({ useToast: () => ({ show: mockToast }) }));
jest.mock('@/lib/queuePickedVideo', () => ({ queuePickedVideo: (...args: unknown[]) => mockQueueVideo(...args) }));
jest.mock('@/lib/importQueue', () => ({ pokeImportQueue: jest.fn(), getImportForUser: () => ({ userId: mockUserId }) }));
jest.mock('@/lib/localNotify', () => ({ maybeOfferNotifPrompt: () => mockOfferNotifications() }));
jest.mock('@/lib/aiConsent', () => ({
    AI_CONSENT_PROMPT_SETTLE_MS: 0,
    isAiBoundUrl: (url: string | null | undefined) => !/maps\.app\.goo\.gl/.test(url ?? ''),
    requestAiImportConsent: (...args: unknown[]) => mockRequestAiConsent(...args),
}));
let mockResolverState: 'idle' | 'success' = 'idle';
let mockResolverData: unknown = null;
jest.mock('@/hooks/wishlist/useResolveUrl', () => ({
    useResolveUrl: () => ({
        resolve: mockResolve, cancel: mockCancel, state: mockResolverState, data: mockResolverData,
    }),
}));
jest.mock('@/hooks/wishlist/useSaveImportSpots', () => ({ useSaveImportSpots: () => ({ mutate: jest.fn() }) }));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/lib/track', () => ({ track: jest.fn() }));
jest.mock('@/lib/importActivation', () => ({ markImportCompleted: jest.fn() }));
jest.mock('@/lib/imageDownscale', () => ({ downscaleAndUpload: (...args: unknown[]) => mockUpload(...args) }));
jest.mock('@/lib/uuid', () => ({ safeRandomUUID: () => 'test-nonce' }));
jest.mock('@/modules/media-extract', () => ({
    isVideoImportAvailable: () => true,
    isBackgroundVideoCaptureAvailable: () => mockBackgroundCapture,
    pickVideoForImport: (...args: unknown[]) => mockNativePick(...args),
    extractFromVideo: (...args: unknown[]) => mockExtract(...args),
}));
jest.mock('../DestinationPicker', () => ({ DestinationPicker: 'DestinationPicker' }));
jest.mock('../CandidatePickerPanel', () => ({
    ...jest.requireActual('../candidatePickerUtils'),
    CandidatePickerPanel: 'CandidatePickerPanel',
}));
jest.mock('@/components/sheets/SnapSheet', () => ({
    SnapSheet: ({ renderHeader, renderContent }: any) => <>{renderHeader()}{renderContent({})}</>,
}));

import { ImportLinkSheet, type ImportLinkSheetProps } from '../ImportLinkSheet';
import { ClipTray } from '../ClipTray';
import { Colors } from '@/constants/theme';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

describe('ImportLinkSheet direct media entry', () => {
    let tree: any;
    let props: ImportLinkSheetProps;

    beforeEach(() => {
        props = { visible: true, openTo: 'video', onDismiss: jest.fn() };
        mockBackgroundCapture = false;
        mockUserId = 'owner-1';
        mockRequestAiConsent.mockReset().mockResolvedValue({ granted: true, prompted: false });
        mockResolve.mockReset();
        mockNativePick.mockReset();
        mockQueueVideo.mockReset().mockResolvedValue({ jobId: 'job-1' });
        mockPick.mockReset().mockImplementation(() => new Promise(() => {}));
        mockExtract.mockReset().mockImplementation(() => new Promise(() => {}));
        mockUpload.mockReset().mockImplementation(() => new Promise(() => {}));
        mockResolverState = 'idle';
        mockResolverData = null;
    });

    afterEach(async () => {
        if (tree) await act(async () => { tree.unmount(); });
        tree = undefined;
    });

    async function render(next: Partial<ImportLinkSheetProps> = {}) {
        props = { ...props, ...next };
        await act(async () => {
            if (tree) tree.update(<ImportLinkSheet {...props} />);
            else tree = TestRenderer.create(<ImportLinkSheet {...props} />);
        });
    }

    function modal() { return tree.root.findByType('Modal'); }
    function text() { return JSON.stringify(tree.toJSON()); }
    async function shown() { await act(async () => { modal().props.onShow(); }); }

    it.each(['video', 'screenshot'] as const)('asks before opening the %s picker and closes on Not now (TICKET-250)', async (openTo) => {
        mockRequestAiConsent.mockResolvedValue({ granted: false, prompted: true });
        await render({ openTo });
        await shown();
        // Not now also waits out the alert's exit before dismissing the Modal.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(mockRequestAiConsent).toHaveBeenCalledWith('owner-1');
        expect(mockPick).not.toHaveBeenCalled();
        expect(mockNativePick).not.toHaveBeenCalled();
        expect(mockUpload).not.toHaveBeenCalled();
        expect(props.onDismiss).toHaveBeenCalledTimes(1);
    });

    it.each(['video', 'screenshot'] as const)('opens the %s picker after an Allow (TICKET-250)', async (openTo) => {
        mockRequestAiConsent.mockResolvedValue({ granted: true, prompted: true });
        await render({ openTo });
        await shown();
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(mockPick).toHaveBeenCalledTimes(1);
    });

    describe('shared links (TICKET-250)', () => {
        const tiktok = 'https://www.tiktok.com/@chef/video/123';

        it('asks before a TikTok link goes out and keeps it in the field on Not now', async () => {
            mockRequestAiConsent.mockResolvedValue({ granted: false, prompted: true });
            await render({ openTo: undefined, initialUrl: tiktok });
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
            expect(mockRequestAiConsent).toHaveBeenCalledWith('owner-1');
            expect(mockResolve).not.toHaveBeenCalled();
            expect(text()).toContain('paste a link');
        });

        it('resolves the link once allowed', async () => {
            await render({ openTo: undefined, initialUrl: tiktok });
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
            expect(mockResolve).toHaveBeenCalledWith(tiktok);
        });

        it('never asks for a Google Maps link, which no model reads', async () => {
            const maps = 'https://maps.app.goo.gl/yMEXGo9h9PAqKQfZ6';
            await render({ openTo: undefined, initialUrl: maps });
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
            expect(mockRequestAiConsent).not.toHaveBeenCalled();
            expect(mockResolve).toHaveBeenCalledWith(maps);
        });
    });

    it.each(['video', 'screenshot'] as const)('opens %s only after host presentation, without source content or another scrim', async (openTo) => {
        await render({ visible: false });
        await render({ visible: true, openTo });
        expect(modal().props.animationType).toBe('none');
        expect(modal().children).toHaveLength(0);
        expect(mockPick).not.toHaveBeenCalled();

        await shown();
        expect(mockPick).toHaveBeenCalledWith(expect.objectContaining({
            mediaTypes: openTo === 'video' ? 'Videos' : 'Images',
        }));
        expect(modal().children).toHaveLength(0);
        await shown();
        expect(mockPick).toHaveBeenCalledTimes(1);
    });

    it.each(['video', 'screenshot'] as const)('returns %s cancellation to the tray and supports reopening', async (openTo) => {
        mockPick.mockResolvedValue({ canceled: true, assets: null });
        await render({ openTo });
        await shown();
        expect(props.onDismiss).toHaveBeenCalledTimes(1);
        expect(text()).not.toContain('import spots');
        expect(mockExtract).not.toHaveBeenCalled();
        expect(mockUpload).not.toHaveBeenCalled();

        await render({ visible: false });
        await render({ visible: true });
        await shown();
        expect(mockPick).toHaveBeenCalledTimes(2);
        expect(props.onDismiss).toHaveBeenCalledTimes(2);
    });

    it('hands a selected video to the durable queue and closes without awaiting OCR', async () => {
        const queued = deferred<{ jobId: string }>();
        mockQueueVideo.mockReturnValue(queued.promise);
        mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///video.mp4' }] });
        await render();
        await shown();
        expect(mockQueueVideo).toHaveBeenCalledWith('file:///video.mp4', 'owner-1', expect.any(Function), expect.any(Function));
        expect(text()).toContain('adding your video');
        expect(text()).not.toContain('import spots');
        expect(props.onDismiss).not.toHaveBeenCalled();
        await act(async () => { queued.resolve({ jobId: 'job-1' }); });
        expect(props.onDismiss).toHaveBeenCalledTimes(1);
        expect(mockExtract).not.toHaveBeenCalled();
        expect(mockToast).not.toHaveBeenCalled();
        expect(mockOfferNotifications).not.toHaveBeenCalled();
        await act(async () => { modal().props.onDismiss(); });
        expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('video added'), expect.objectContaining({ label: 'view' }));
        expect(mockOfferNotifications).toHaveBeenCalledTimes(1);
    });

    it('closes after native selection while native download remains independently queued', async () => {
        mockBackgroundCapture = true;
        mockNativePick.mockResolvedValue({ canceled: false, jobId: 'native-preparing-job' });
        const onVideoQueued = jest.fn();
        await render({ onVideoQueued });
        await shown();
        expect(mockNativePick).toHaveBeenCalledWith('owner-1');
        expect(mockQueueVideo).not.toHaveBeenCalled();
        expect(mockPick).not.toHaveBeenCalled();
        expect(mockExtract).not.toHaveBeenCalled();
        expect(props.onDismiss).toHaveBeenCalledTimes(1);
        expect(onVideoQueued).not.toHaveBeenCalled();
        await act(async () => { modal().props.onDismiss(); });
        expect(onVideoQueued).toHaveBeenCalledWith('native-preparing-job');
    });

    it('keeps a capture failure visible and never claims the video was queued', async () => {
        mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///video.mp4' }] });
        mockQueueVideo.mockRejectedValue(new Error('native write failed'));
        await render();
        await shown();
        expect(text()).toContain("couldn't add that video");
        expect(props.onDismiss).not.toHaveBeenCalled();
        expect(mockToast).not.toHaveBeenCalled();
        expect(mockOfferNotifications).not.toHaveBeenCalled();
    });

    it('suppresses old-account feedback when native selection returns after an account switch', async () => {
        mockBackgroundCapture = true;
        const native = deferred<{ canceled: boolean; jobId: string }>();
        mockNativePick.mockReturnValue(native.promise);
        await render();
        await shown();
        mockUserId = 'owner-2';
        await render();
        await act(async () => { native.resolve({ canceled: false, jobId: 'old-owner-job' }); });
        expect(mockToast).not.toHaveBeenCalled();
        expect(props.onDismiss).not.toHaveBeenCalled();
        expect(mockQueueVideo).not.toHaveBeenCalled();
    });

    it('shows screenshot progress only after selection and ignores upload after dismissal', async () => {
        const upload = deferred<{ storagePath: string }>();
        mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///photo.png' }] });
        mockUpload.mockReturnValue(upload.promise);
        await render({ openTo: 'screenshot' });
        await shown();
        expect(text()).toContain('reading the screenshot');
        await act(async () => { modal().props.onRequestClose(); });
        await act(async () => { upload.resolve({ storagePath: 'owner-1/photo.jpg' }); });
        expect(mockResolve).not.toHaveBeenCalled();
        expect(text()).not.toContain('import spots');
    });

    it.each(['video', 'screenshot'] as const)('ignores a %s picker result delivered after dismissal', async (openTo) => {
        const picker = deferred<any>();
        mockPick.mockReturnValue(picker.promise);
        await render({ openTo });
        await shown();
        await act(async () => { modal().props.onRequestClose(); });
        await act(async () => { picker.resolve({ canceled: false, assets: [{ uri: 'file:///stale' }] }); });
        expect(mockExtract).not.toHaveBeenCalled();
        expect(mockUpload).not.toHaveBeenCalled();
        expect(mockResolve).not.toHaveBeenCalled();
    });

    it('retains the menu for existing callers and their picker cancellation', async () => {
        mockPick.mockResolvedValue({ canceled: true, assets: null });
        await render({ openTo: 'menu' });
        expect(text()).toContain('import spots');
        await shown();
        expect(mockPick).not.toHaveBeenCalled();
        await act(async () => { tree.root.findByProps({ accessibilityLabel: 'from a video' }).props.onPress(); });
        expect(text()).toContain('import spots');
        expect(props.onDismiss).not.toHaveBeenCalled();
    });

    it('offers a retry when the native picker fails to open', async () => {
        mockPick.mockRejectedValueOnce(new Error('presentation failed'));
        await render({ openTo: 'screenshot' });
        await shown();
        expect(text()).toContain("couldn't open your photos");
        await act(async () => { tree.root.findByProps({ accessibilityLabel: 'retry' }).props.onPress(); });
        expect(mockPick).toHaveBeenCalledTimes(2);
        expect(mockPick).toHaveBeenLastCalledWith(expect.objectContaining({ mediaTypes: 'Images' }));
        expect(mockResolve).not.toHaveBeenCalled();
    });

    it.each(['video', 'screenshot'] as const)('wires the tray %s action to its direct picker', async (kind) => {
        await act(async () => {
            tree = TestRenderer.create(<ClipTray visible onDismiss={jest.fn()} palette={Colors.light}
                rows={[]} hasOlder={false} isEmpty />);
        });
        await act(async () => {
            tree.root.findAllByType('View').find((node: any) => node.props.onLayout)
                .props.onLayout({ nativeEvent: { layout: { height: 900 } } });
        });
        await act(async () => {
            // The host stub retains hidden Modal children, so choose the tray's
            // first action rather than the still-hidden legacy source menu.
            tree.root.findAllByProps({ accessibilityLabel: `from a ${kind}` })[0].props.onPress();
        });
        const child = tree.root.findByType(ImportLinkSheet);
        expect(child.props.openTo).toBe(kind);
        expect(child.props.visible).toBe(true);
        expect(child.findByType('Modal').children).toHaveLength(0);
    });
});

describe('pasted text and screenshot lists (2026-09-25)', () => {
    let tree: any;
    const list = 'my london list:\n1. Bao Soho\n2. Kiln\n3. Brat\nskip Sketch';

    beforeEach(() => {
        mockUserId = 'owner-1';
        mockRequestAiConsent.mockReset().mockResolvedValue({ granted: true, prompted: false });
        mockResolve.mockReset();
        mockResolverState = 'idle';
        mockResolverData = null;
    });

    afterEach(async () => {
        if (tree) await act(async () => { tree.unmount(); });
        tree = undefined;
        mockResolverState = 'idle';
        mockResolverData = null;
    });

    async function openTray() {
        await act(async () => {
            tree = TestRenderer.create(<ClipTray visible onDismiss={jest.fn()} palette={Colors.light}
                rows={[]} hasOlder={false} isEmpty />);
        });
        await act(async () => {
            tree.root.findAllByType('View').find((node: any) => node.props.onLayout)
                .props.onLayout({ nativeEvent: { layout: { height: 900 } } });
        });
    }

    async function pasteIntoTray(value: string) {
        await act(async () => {
            tree.root.findByProps({ accessibilityLabel: 'place link or list' }).props.onChangeText(value);
        });
        const go = tree.root.findByProps({ accessibilityLabel: 'find places' });
        expect(go.props.disabled).toBe(false);
        await act(async () => { go.props.onPress(); });
    }

    it('reads every place in a pasted list from the clip tray', async () => {
        await openTray();
        await pasteIntoTray(list);
        const child = tree.root.findByType(ImportLinkSheet);
        expect(child.props.initialText).toBe(list);
        expect(child.props.initialUrl).toBeUndefined();
        expect(mockRequestAiConsent).toHaveBeenCalled();
        expect(mockResolve).toHaveBeenCalledWith('', undefined, undefined, list, 'text');
    });

    it('offers one-tap paste while empty, then clear and go', async () => {
        await openTray();
        const paste = tree.root.findByType('ClipboardPasteButton');
        expect(paste.props.acceptedContentTypes).toEqual(['plain-text', 'url']);
        expect(tree.root.findAllByProps({ accessibilityLabel: 'find places' })).toHaveLength(0);
        await act(async () => { paste.props.onPress({ type: 'text', text: list }); });
        expect(tree.root.findByProps({ accessibilityLabel: 'place link or list' }).props.value).toBe(list);
        expect(tree.root.findAllByType('ClipboardPasteButton')).toHaveLength(0);
        await act(async () => { tree.root.findByProps({ accessibilityLabel: 'clear' }).props.onPress(); });
        expect(tree.root.findByProps({ accessibilityLabel: 'place link or list' }).props.value).toBe('');
    });

    it('falls back to a plain paste button where the native control is missing', async () => {
        mockPasteButtonAvailable = false;
        mockGetString.mockResolvedValueOnce(list).mockRejectedValueOnce(new Error('declined'));
        try {
            await openTray();
            expect(tree.root.findAllByType('ClipboardPasteButton')).toHaveLength(0);
            await act(async () => { await tree.root.findByProps({ accessibilityLabel: 'paste' }).props.onPress(); });
            expect(tree.root.findByProps({ accessibilityLabel: 'place link or list' }).props.value).toBe(list);
            await act(async () => { tree.root.findByProps({ accessibilityLabel: 'clear' }).props.onPress(); });
            await act(async () => { await tree.root.findByProps({ accessibilityLabel: 'paste' }).props.onPress(); });
            expect(tree.root.findByProps({ accessibilityLabel: 'place link or list' }).props.value).toBe('');
        } finally {
            mockPasteButtonAvailable = true;
        }
    });

    it('still resolves a pasted link as a link', async () => {
        await openTray();
        await pasteIntoTray('https://maps.app.goo.gl/AbC123');
        const child = tree.root.findByType(ImportLinkSheet);
        expect(child.props.initialUrl).toBe('https://maps.app.goo.gl/AbC123');
        expect(child.props.initialText).toBeUndefined();
        expect(mockResolve).toHaveBeenCalledWith('https://maps.app.goo.gl/AbC123');
    });

    it('sends nothing on Not now and leaves the text in the field', async () => {
        mockRequestAiConsent.mockResolvedValue({ granted: false, prompted: true });
        await act(async () => {
            tree = TestRenderer.create(<ImportLinkSheet visible onDismiss={jest.fn()} initialText={list} />);
        });
        // The consent prompt settles on a timer before the sheet moves on.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(mockResolve).not.toHaveBeenCalled();
        expect(tree.root.findByProps({ accessibilityLabel: 'paste a link or a list of places' }).props.value).toBe(list);
    });

    it('reads a list typed into the paste step as text', async () => {
        await act(async () => {
            tree = TestRenderer.create(<ImportLinkSheet visible onDismiss={jest.fn()} />);
        });
        await act(async () => { tree.root.findByProps({ accessibilityLabel: 'paste a link or list' }).props.onPress(); });
        await act(async () => {
            tree.root.findByProps({ accessibilityLabel: 'paste a link or a list of places' }).props.onChangeText(list);
        });
        await act(async () => { tree.root.findByProps({ accessibilityLabel: 'find it' }).props.onPress(); });
        expect(mockResolve).toHaveBeenCalledWith('', undefined, undefined, list, 'text');
    });

    it('retries a failed screenshot read on the same upload, not an old link', async () => {
        mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///chat.png' }] });
        mockUpload.mockResolvedValue({ storagePath: 'owner-1/chat.jpg' });
        await act(async () => {
            tree = TestRenderer.create(<ImportLinkSheet visible onDismiss={jest.fn()} openTo="screenshot" />);
        });
        await act(async () => { tree.root.findByType('Modal').props.onShow(); });
        expect(mockResolve).toHaveBeenCalledWith('', 'owner-1/chat.jpg');
        expect(JSON.stringify(tree.toJSON())).toContain('reading the screenshot');
    });

    it('puts every place from a screenshot in the picker', async () => {
        const candidate = (name: string) => ({
            candidate_id: name,
            restaurant: { id: '', name, external_id: null },
            confidence: 'high',
            google_place_id: null,
            restaurant_id: null,
            already_wishlisted: false,
        });
        mockResolverState = 'success';
        mockResolverData = {
            source_type: 'screenshot',
            best_query: 'Bao Soho',
            note_prefill: '',
            candidates: [candidate('Bao Soho'), candidate('Kiln'), candidate('Brat')],
            partial_source: null,
        };
        await act(async () => {
            tree = TestRenderer.create(<ImportLinkSheet visible onDismiss={jest.fn()} />);
        });
        const picker = tree.root.findByType('CandidatePickerPanel');
        expect(picker.props.candidates).toHaveLength(3);
        expect(tree.root.findAllByType('DestinationPicker')).toHaveLength(0);
    });
});
