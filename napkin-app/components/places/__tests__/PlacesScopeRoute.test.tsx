/* eslint-disable import/first -- route mocks must be registered before imports. */
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
        StyleSheet: {
            create: (styles: unknown) => styles,
            hairlineWidth: 1,
            flatten: (style: unknown): Record<string, unknown> =>
                (Array.isArray(style) ? style : [style])
                    .flat(Infinity)
                    .filter(Boolean)
                    .reduce<Record<string, unknown>>(
                        (acc, item) => ({ ...acc, ...(item as Record<string, unknown>) }),
                        {},
                    ),
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('expo-router', () => ({
    Stack: { Screen: () => null },
    useLocalSearchParams: () => ({ scope: 'table', tableId: 'table-a' }),
    useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: mockCanGoBack }),
}));
jest.mock('@/components/places/PlacesScreen', () => {
    const ReactModule = jest.requireActual('react');
    const { Text, View } = jest.requireMock('react-native');
    return {
        PlacesScreen: (props: Record<string, unknown>) => ReactModule.createElement(
            View,
            { testID: 'scoped-places', ...props },
            ReactModule.createElement(
                Text,
                null,
                `${(props.lockedScope as { kind: string }).kind}:${(props.lockedScope as { tableId: string }).tableId}`,
            ),
        ),
    };
});

import React from 'react';
import { act, render } from '@testing-library/react-native';

import PlacesScopeRoute from '@/app/places-scope';

describe('Places scoped route', () => {
    beforeEach(() => {
        mockBack.mockClear();
        mockReplace.mockClear();
        mockCanGoBack.mockReset().mockReturnValue(true);
    });

    it('locks the table scope, removes tab chrome, and delegates hierarchical back', () => {
        const screen = render(<PlacesScopeRoute />);
        const places = screen.getByTestId('scoped-places');
        expect(screen.getByText('table:table-a')).toBeTruthy();
        expect(places.props).toMatchObject({
            lockedScope: { kind: 'table', tableId: 'table-a' },
            hasBottomNav: false,
            showImport: false,
        });
        expect(places.props.stateStore).toBeDefined();
        act(() => places.props.onBack());
        expect(mockBack).toHaveBeenCalledTimes(1);
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('replaces with the Table tab on a cold deep link with no back stack', () => {
        mockCanGoBack.mockReturnValue(false);
        const screen = render(<PlacesScopeRoute />);
        const places = screen.getByTestId('scoped-places');
        act(() => places.props.onBack());
        expect(mockBack).not.toHaveBeenCalled();
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)/tables');
    });
});
