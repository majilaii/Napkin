/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockAlert = jest.fn();
const mockRefetchProfile = jest.fn();
const mockRefetchSpots = jest.fn();
const mockUpdateProfile = jest.fn();
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
                avatar_url: null,
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

jest.mock('../ProfileHeader', () => ({
    ProfileHeader: (props: Record<string, unknown>) =>
        require('react').createElement('ProfileHeader', props),
}));
jest.mock('../TopFour', () => ({ TopFour: 'TopFour' }));
jest.mock('../ProfileTopFourSheet', () => ({ ProfileTopFourSheet: 'ProfileTopFourSheet' }));
jest.mock('../QuickTakes', () => ({ QuickTakes: 'QuickTakes' }));
jest.mock('../QuickTakesSheet', () => ({ QuickTakesSheet: 'QuickTakesSheet' }));
jest.mock('../TasteSignature', () => ({ TasteSignature: 'TasteSignature' }));
jest.mock('../DiningMapPreview', () => ({ DiningMapPreview: 'DiningMapPreview' }));
jest.mock('../ListsShelf', () => ({ ListsShelf: 'ListsShelf' }));
jest.mock('../ProfileIndex', () => ({ ProfileIndex: 'ProfileIndex' }));
jest.mock('../TablesInCommonSection', () => ({
    TablesInCommonSection: 'TablesInCommonSection',
}));
jest.mock('../NotFoundState', () => ({ NotFoundState: 'NotFoundState' }));

import { chooseAndSaveNewProfilePhoto } from '@/lib/profilePhoto';
import { ProfileScreenBody } from '../ProfileScreenBody';

const mockChooseAndSave = chooseAndSaveNewProfilePhoto as jest.MockedFunction<
    typeof chooseAndSaveNewProfilePhoto
>;

function renderBody() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(<ProfileScreenBody identifier="user-1" inTab />);
    });
    return renderer;
}

function profileHeader(renderer: ReturnType<typeof renderBody>) {
    return renderer.root.findByType('ProfileHeader');
}

describe('ProfileScreenBody add-photo orchestration', () => {
    beforeEach(() => {
        mockConnectivityStatus = 'online';
        mockAlert.mockReset();
        mockChooseAndSave.mockReset();
        mockUpdateProfile.mockReset();
    });

    it('explains the offline block without opening the picker', async () => {
        mockConnectivityStatus = 'offline';
        const renderer = renderBody();

        await act(async () => {
            await profileHeader(renderer).props.onAddPhoto();
        });

        expect(mockChooseAndSave).not.toHaveBeenCalled();
        expect(mockAlert).toHaveBeenCalledWith(
            'No connection',
            'Connect to the internet to add a profile photo.',
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
            action = profileHeader(renderer).props.onAddPhoto();
        });

        expect(profileHeader(renderer).props.isAddingPhoto).toBe(true);
        expect(mockChooseAndSave).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'user-1' }),
        );

        await act(async () => {
            finishSelection(false);
            await action;
        });

        expect(profileHeader(renderer).props.isAddingPhoto).toBe(false);
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
            await profileHeader(renderer).props.onAddPhoto();
        });

        expect(mockAlert).toHaveBeenCalledWith(
            "Couldn't save that photo",
            'Please try again.',
        );
        expect(profileHeader(renderer).props.isAddingPhoto).toBe(false);
        act(() => renderer.unmount());
    });
});
