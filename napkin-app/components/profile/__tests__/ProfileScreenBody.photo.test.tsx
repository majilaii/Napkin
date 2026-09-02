/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockAlert = jest.fn();
const mockRefetchProfile = jest.fn();
const mockRefetchSpots = jest.fn();
const mockUpdateProfile = jest.fn();
const mockUseLedger = jest.fn((..._args: unknown[]) => ({
    data: { rows: [] },
    refetch: jest.fn(),
}));
let mockConnectivityStatus: 'checking' | 'online' | 'offline' = 'online';

const mockProfileResult = {
    data: {
        isNotFound: false,
        data: {
            profile: {
                user_id: 'user-1',
                username: 'clara',
                display_name: 'Clara Example',
                bio: null,
                avatar_url: 'https://cdn.example/old.jpg',
                account_privacy: 'public',
                allow_public_replies: true,
            },
            is_self: true,
            viewer_target_relationship: 'self',
            blocked_by_viewer: false,
            private_stub: false,
            stats: {
                total_logs: 0,
                total_restaurants: 0,
                reviews_count: 0,
            },
            social: null,
            recently_logged: [],
            public_lists: [],
            top_four: [],
            quick_takes: [],
            tables_in_common: [],
        },
    },
    isLoading: false,
    error: null,
    refetch: mockRefetchProfile,
    isRefetching: false,
};

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => {
        const Component = (props: Record<string, unknown>) =>
            ReactModule.createElement(name, props, props.children);
        Component.displayName = name;
        return Component;
    };

    return {
        ActivityIndicator: host('ActivityIndicator'),
        Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
        Pressable: host('Pressable'),
        RefreshControl: host('RefreshControl'),
        ScrollView: host('ScrollView'),
        Text: host('Text'),
        View: host('View'),
        StyleSheet: { create: (styles: unknown) => styles },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    };
});

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/users/useUserProfile', () => ({
    useUserProfile: () => mockProfileResult,
}));
jest.mock('@/hooks/users/useUpdateProfile', () => ({
    useUpdateProfile: () => ({ isPending: false, mutateAsync: mockUpdateProfile }),
}));
jest.mock('@/hooks/users/useUserSpots', () => ({
    useUserSpots: () => ({ data: [], refetch: mockRefetchSpots }),
    deriveTaste: () => ({ topCuisines: [], cityCount: 0, countryCount: 0 }),
}));
jest.mock('@/hooks/users/useLedger', () => ({
    deviceTimeZone: () => 'UTC',
    ledgerMonthFor: () => '2026-09',
    useLedger: (...args: unknown[]) => mockUseLedger(...args),
}));
jest.mock('@/hooks/account', () => ({
    useReportContent: () => ({ mutate: jest.fn() }),
    useBlockUser: () => ({ mutate: jest.fn() }),
    useUnblockUser: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/imports/useImportSlot', () => ({
    useImportSlot: () => null,
}));
jest.mock('@/providers/ConnectivityProvider', () => ({
    useConnectivity: () => ({ status: mockConnectivityStatus }),
}));
jest.mock('@/lib/profilePhoto', () => ({
    chooseAndSaveNewProfilePhoto: jest.fn(),
    shouldBlockProfilePhotoPicker: (status: string) => status === 'offline',
}));
jest.mock('@/lib/imageStaging', () => ({
    isModerationRejected: (error: { code?: string }) => error?.code === 'moderation_rejected',
}));

jest.mock('../ProfileHeader', () => ({
    ProfileHeader: (props: Record<string, unknown>) =>
        require('react').createElement('ProfileHeader', props),
}));
jest.mock('../TopFour', () => ({ TopFour: 'TopFour' }));
jest.mock('../ProfileTopFourSheet', () => ({ ProfileTopFourSheet: 'ProfileTopFourSheet' }));
jest.mock('../QuickTakes', () => ({ QuickTakes: 'QuickTakes' }));
jest.mock('../QuickTakesSheet', () => ({ QuickTakesSheet: 'QuickTakesSheet' }));
jest.mock('../TasteSignature', () => ({ TasteSignature: 'TasteSignature' }));
// Host-string mocks — ListsShelf's useMyLists and ImportAttentionCard's
// PressableScale/router chains never run.
jest.mock('../ListsShelf', () => ({ ListsShelf: 'ListsShelf' }));
jest.mock('../ImportAttentionCard', () => ({ ImportAttentionCard: 'ImportAttentionCard' }));
jest.mock('../ProfileIndex', () => ({ ProfileIndex: 'ProfileIndex' }));
jest.mock('../TablesInCommonSection', () => ({
    TablesInCommonSection: 'TablesInCommonSection',
}));
jest.mock('../NotFoundState', () => ({ NotFoundState: 'NotFoundState' }));
jest.mock('../ProfileNapkinsLine', () => ({ ProfileNapkinsLine: 'ProfileNapkinsLine' }));

import { chooseAndSaveNewProfilePhoto } from '@/lib/profilePhoto';
import { ProfileScreenBody } from '../ProfileScreenBody';

const mockChooseAndSave = chooseAndSaveNewProfilePhoto as jest.MockedFunction<
    typeof chooseAndSaveNewProfilePhoto
>;

function renderBody(inTab = true) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <ProfileScreenBody identifier="user-1" inTab={inTab} />,
        );
    });
    return renderer;
}

function profileHeader(renderer: ReturnType<typeof renderBody>) {
    return renderer.root.findByType('ProfileHeader');
}

describe('ProfileScreenBody avatar-swap orchestration', () => {
    beforeEach(() => {
        mockConnectivityStatus = 'online';
        mockAlert.mockReset();
        mockChooseAndSave.mockReset();
        mockUpdateProfile.mockReset();
        mockUseLedger.mockClear();
    });

    it('does not expose the swap action on the public profile surface, even for self', () => {
        const renderer = renderBody(false);

        expect(profileHeader(renderer).props.onChangePhoto).toBeUndefined();
        expect(profileHeader(renderer).props.isChangingPhoto).toBe(false);
        expect(mockUseLedger).toHaveBeenCalledWith('user-1', '2026-09', 'UTC', undefined, false);
        expect(renderer.root.findAllByType('ProfileNapkinsLine')).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('explains the offline block without opening the picker', async () => {
        mockConnectivityStatus = 'offline';
        const renderer = renderBody();

        await act(async () => {
            await profileHeader(renderer).props.onChangePhoto();
        });

        expect(mockChooseAndSave).not.toHaveBeenCalled();
        expect(mockAlert).toHaveBeenCalledWith(
            'No connection',
            'Connect to the internet to change your profile photo.',
        );
        act(() => renderer.unmount());
    });

    it('shows busy while the picker transaction runs and clears it on cancellation', async () => {
        let finishSelection!: (saved: boolean) => void;
        mockChooseAndSave.mockImplementation(({ onSourceChosen }) => {
            onSourceChosen();
            return new Promise<boolean>((resolve) => {
                finishSelection = resolve;
            });
        });
        const renderer = renderBody();
        let action!: Promise<void>;

        act(() => {
            action = profileHeader(renderer).props.onChangePhoto();
        });

        expect(profileHeader(renderer).props.isChangingPhoto).toBe(true);
        expect(mockChooseAndSave).toHaveBeenCalledWith(
            expect.objectContaining({
                onSourceChosen: expect.any(Function),
                saveAvatarUrl: expect.any(Function),
            }),
        );

        await act(async () => {
            finishSelection(false);
            await action;
        });

        expect(profileHeader(renderer).props.isChangingPhoto).toBe(false);
        expect(mockAlert).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('saves a picked replacement through the profile mutation', async () => {
        mockUpdateProfile.mockResolvedValue(undefined);
        mockChooseAndSave.mockImplementation(
            async ({ onSourceChosen, saveAvatarUrl }) => {
                onSourceChosen();
                await saveAvatarUrl('https://cdn.example/new.jpg');
                return true;
            },
        );
        const renderer = renderBody();

        await act(async () => {
            await profileHeader(renderer).props.onChangePhoto();
        });

        expect(mockChooseAndSave).toHaveBeenCalledWith(
            expect.objectContaining({
                onSourceChosen: expect.any(Function),
                saveAvatarUrl: expect.any(Function),
            }),
        );
        expect(mockUpdateProfile).toHaveBeenCalledWith({
            avatar_url: 'https://cdn.example/new.jpg',
        });
        expect(mockAlert).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('alerts and clears busy when the picker transaction fails', async () => {
        mockChooseAndSave.mockImplementation(({ onSourceChosen }) => {
            onSourceChosen();
            return Promise.reject(new Error('upload failed'));
        });
        const renderer = renderBody();

        await act(async () => {
            await profileHeader(renderer).props.onChangePhoto();
        });

        expect(mockAlert).toHaveBeenCalledWith(
            "Couldn't save that photo",
            'Please try again.',
        );
        expect(profileHeader(renderer).props.isChangingPhoto).toBe(false);
        act(() => renderer.unmount());
    });

    it('uses the moderation-specific retry alert for a rejected quick-swap', async () => {
        mockChooseAndSave.mockImplementation(({ onSourceChosen }) => {
            onSourceChosen();
            return Promise.reject(Object.assign(new Error('rejected'), {
                code: 'moderation_rejected',
            }));
        });
        const renderer = renderBody();

        await act(async () => {
            await profileHeader(renderer).props.onChangePhoto();
        });

        expect(mockAlert).toHaveBeenCalledWith(
            "That photo can't be used",
            'Choose another photo.',
        );
        expect(profileHeader(renderer).props.isChangingPhoto).toBe(false);
        act(() => renderer.unmount());
    });
});
