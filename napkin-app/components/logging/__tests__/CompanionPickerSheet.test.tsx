import type ReactType from 'react';

(globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = true;

jest.unmock('react-native');
// Match the iOS resolution supplied by the React Native/Jest preset; the
// repository's custom Jest resolver does not apply platform extensions.
jest.mock('react-native/Libraries/Utilities/Platform', () =>
    jest.requireActual('react-native/Libraries/Utilities/Platform.ios')
);
jest.mock('react-native/Libraries/Modal/Modal', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof ReactType;
    return {
        __esModule: true,
        default: ({ children, visible }: { children: ReactType.ReactNode; visible?: boolean }) =>
            visible ? ReactModule.createElement(ReactModule.Fragment, null, children) : null,
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('@/hooks/users/useUserSearch', () => ({ useUserSearch: jest.fn() }));
jest.mock('@/hooks/users/useRecentCompanions', () => ({ useRecentCompanions: jest.fn() }));

// Runtime imports must follow __DEV__ because this suite opts out of the repo's
// global react-native mock and exercises the real host components.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('react-native/jest/setup');
(globalThis as typeof globalThis & { dispatchEvent: () => boolean }).dispatchEvent = jest.fn(() => true);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const React = require('react') as typeof ReactType;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, fireEvent, render } = require('@testing-library/react-native') as typeof import('@testing-library/react-native');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Colors } = require('@/constants/theme') as typeof import('@/constants/theme');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useRecentCompanions } = require('@/hooks/users/useRecentCompanions') as typeof import('@/hooks/users/useRecentCompanions');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useUserSearch } = require('@/hooks/users/useUserSearch') as typeof import('@/hooks/users/useUserSearch');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CompanionPickerSheet } = require('../CompanionPickerSheet') as typeof import('../CompanionPickerSheet');

const baseProps = {
    visible: true,
    onClose: jest.fn(),
    selectedIds: new Set<string>(),
    onToggle: jest.fn(),
    currentUserId: 'viewer',
    palette: Colors.light,
};

describe('CompanionPickerSheet mutual-only search', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        (useRecentCompanions as jest.Mock).mockReturnValue({
            data: [],
            isLoading: false,
        });
        (useUserSearch as jest.Mock).mockReturnValue({
            data: [],
            isLoading: false,
        });
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('requests mutual search results and labels the field Search friends', () => {
        const screen = render(<CompanionPickerSheet {...baseProps} />);

        expect(screen.getByPlaceholderText('Search friends')).toBeTruthy();
        expect(useUserSearch).toHaveBeenCalledWith('', true, { mutualOnly: true });
    });

    it('hides a non-mutual result and shows the one-line empty copy', () => {
        (useUserSearch as jest.Mock).mockReturnValue({
            data: [{
                user_id: 'stranger',
                display_name: 'Public Stranger',
                avatar_url: null,
                is_mutual: false,
            }],
            isLoading: false,
        });
        const screen = render(<CompanionPickerSheet {...baseProps} />);

        fireEvent.changeText(screen.getByPlaceholderText('Search friends'), 'stranger');
        act(() => jest.advanceTimersByTime(300));

        expect(useUserSearch).toHaveBeenLastCalledWith('stranger', true, { mutualOnly: true });
        expect(screen.queryByText('Public Stranger')).toBeNull();
        expect(screen.getByText('no mutual follows match')).toBeTruthy();
    });
});
