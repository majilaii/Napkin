/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockAlert = jest.fn();
const mockDismissMutate = jest.fn();
const mockRetryMutate = jest.fn();
const mockCorrectMutateAsync = jest.fn();
let mockExhaustedItems: Record<string, unknown>[] = [];

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => {
        const Component = (props: Record<string, unknown>) =>
            ReactModule.createElement(name, props, props.children);
        Component.displayName = name;
        return Component;
    };
    return {
        // Read mockAlert LAZILY. Babel hoists every `import` in this file —
        // including `../import-progress` far below — above the `const mockAlert`
        // initialiser, and rewrites the const to a `var`. So this factory runs
        // while mockAlert is still undefined; `alert: mockAlert` would capture
        // that undefined permanently and fail with "Alert.alert is not a
        // function". Every other mock here happens to be safe only because it
        // reads its jest.fn() inside a function body, i.e. after assignment.
        Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        ActivityIndicator: host('ActivityIndicator'),
        StyleSheet: { create: (styles: unknown) => styles },
    };
});
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => {
    const ReactModule = require('react');
    return {
        Stack: {
            Screen: (props: Record<string, unknown>) =>
                ReactModule.createElement('StackScreen', props),
        },
        useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/constants/theme', () => {
    const palette = {
        background: '#paper',
        surfaceJournalLow: '#journal',
        text: '#ink',
        textMuted: '#muted',
        primary: '#terracotta',
    };
    return {
        Colors: { light: palette, dark: palette },
        Spacing: { xs: 4, sm: 8, md: 16 },
        Type: { screenTitle: {} },
    };
});
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'user-1' } }),
}));
jest.mock('@/providers/ToastProvider', () => ({
    useToast: () => ({ show: jest.fn() }),
}));
jest.mock('@/hooks/wishlist/useActiveImports', () => ({
    useActiveImports: () => [],
}));
jest.mock('@/hooks/wishlist/useRecentImports', () => ({
    useRecentImports: () => ({ data: [] }),
}));
jest.mock('@/hooks/wishlist/useHasImported', () => ({
    useHasImported: () => true,
}));
jest.mock('@/hooks/imports/useCompletenessRetries', () => ({
    useExhaustedCompletenessItems: () => ({
        data: mockExhaustedItems,
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
    }),
    useRetryCompletenessItem: () => ({
        isPending: false,
        variables: undefined,
        mutate: mockRetryMutate,
    }),
    useDismissCompletenessItem: () => ({
        isPending: false,
        variables: undefined,
        mutate: mockDismissMutate,
    }),
    useCorrectCompletenessItem: () => ({
        isPending: false,
        variables: undefined,
        mutateAsync: mockCorrectMutateAsync,
    }),
}));
jest.mock('@/components/import-education', () => ({
    ImportActivationHub: () => null,
}));
jest.mock('@/components/wishlist/importSourceLabel', () => ({
    importSourceIcon: () => 'link-outline',
    importSourceLabel: () => 'link',
    manifestDisplaySource: () => null,
    relativeTime: () => 'now',
}));
jest.mock('@/components/wishlist/ImportSourceCard', () => ({
    WatchAgainLink: () => null,
}));
jest.mock('@/components/wishlist/ClipThumb', () => ({
    ClipThumb: () => null,
}));
jest.mock('@/components/wishlist/PlacePickerModal', () => ({
    PlacePickerModal: 'PlacePickerModal',
}));
jest.mock('@/lib/importQueue', () => ({
    retryImport: jest.fn(),
    removeImport: jest.fn(),
    setImportMode: jest.fn(),
    setImportSpots: jest.fn(),
    pokeImportQueue: jest.fn(),
}));
jest.mock('@/lib/importResolution', () => ({
    mintImportMatchCorrection: jest.fn(),
}));
jest.mock('@/modules/media-extract', () => ({
    deleteAppGroupFile: jest.fn(),
}));

import ImportProgressScreen from '../app/import-progress';

const IMPORT_NONCE = '00000000-0000-4000-8000-000000000010';

function exhaustedItem(importNonce: string | null) {
    return {
        id: 'item-1',
        job_id: 'job-1',
        item_nonce: 'item-nonce-1',
        import_nonce: importNonce,
        restaurant_id: null,
        restaurant_name: 'Bring Your Own Vinyl Cafe',
        restaurant_city: 'London',
        resolution_id: null,
        external_id: null,
        last_error: 'no result',
        created_at: '2026-07-27T12:00:00Z',
    };
}

function renderScreen() {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(<ImportProgressScreen />);
    });
    return renderer;
}

function actionByLabel(renderer: ReturnType<typeof renderScreen>, label: string) {
    return renderer.root
        .findAllByType('Pressable')
        .find((node: { props: { accessibilityLabel?: string } }) =>
            node.props.accessibilityLabel === label);
}

describe('ImportProgressScreen needs-a-look actions', () => {
    beforeEach(() => {
        mockAlert.mockReset();
        mockDismissMutate.mockReset();
        mockRetryMutate.mockReset();
        mockCorrectMutateAsync.mockReset();
    });

    it('gates find it on the item import nonce', () => {
        mockExhaustedItems = [exhaustedItem(null)];
        const withoutNonce = renderScreen();
        expect(actionByLabel(withoutNonce, 'find Bring Your Own Vinyl Cafe')).toBeUndefined();
        act(() => withoutNonce.unmount());

        mockExhaustedItems = [exhaustedItem(IMPORT_NONCE)];
        const withNonce = renderScreen();
        const find = actionByLabel(withNonce, 'find Bring Your Own Vinyl Cafe');
        expect(find?.props.accessibilityRole).toBe('button');
        expect(actionByLabel(withNonce, 'retry Bring Your Own Vinyl Cafe')?.props.accessibilityRole)
            .toBe('button');
        expect(actionByLabel(withNonce, 'remove Bring Your Own Vinyl Cafe')?.props.accessibilityRole)
            .toBe('button');
        act(() => withNonce.unmount());
    });

    it('confirms removal with accurate copy and fires dismiss', () => {
        mockExhaustedItems = [exhaustedItem(IMPORT_NONCE)];
        const renderer = renderScreen();
        const remove = actionByLabel(renderer, 'remove Bring Your Own Vinyl Cafe');

        act(() => remove?.props.onPress());

        expect(mockAlert).toHaveBeenCalledWith(
            'remove Bring Your Own Vinyl Cafe?',
            "we'll stop trying to match it.",
            expect.any(Array),
        );
        const buttons = mockAlert.mock.calls[0][2] as {
            text: string;
            style: string;
            onPress?: () => void;
        }[];
        const destructive = buttons.find((button) => button.text === 'remove');
        expect(destructive?.style).toBe('destructive');

        act(() => destructive?.onPress?.());

        expect(mockDismissMutate).toHaveBeenCalledWith(
            'item-1',
            expect.objectContaining({
                onSuccess: expect.any(Function),
                onError: expect.any(Function),
            }),
        );
        act(() => renderer.unmount());
    });
});
