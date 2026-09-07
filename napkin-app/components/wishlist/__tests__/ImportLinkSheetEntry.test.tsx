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
jest.mock('expo-clipboard', () => ({ hasStringAsync: jest.fn(async () => false) }));
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
jest.mock('@/hooks/wishlist/useResolveUrl', () => ({
    useResolveUrl: () => ({ resolve: mockResolve, cancel: mockCancel, state: 'idle' }),
}));
jest.mock('@/hooks/wishlist/useCreateImport', () => ({ useCreateImport: () => ({ mutate: jest.fn() }) }));
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
        mockNativePick.mockReset();
        mockQueueVideo.mockReset().mockResolvedValue({ jobId: 'job-1' });
        mockPick.mockReset().mockImplementation(() => new Promise(() => {}));
        mockExtract.mockReset().mockImplementation(() => new Promise(() => {}));
        mockUpload.mockReset().mockImplementation(() => new Promise(() => {}));
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
