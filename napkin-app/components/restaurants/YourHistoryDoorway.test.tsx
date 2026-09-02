/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: host('Pressable'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
            hairlineWidth: 1,
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { View } from 'react-native';

import { Colors } from '@/constants/theme';
import { shouldShowHistoryDoorway, YourHistoryDoorway } from './YourHistoryDoorway';

type CountPayload = {
    personal: { visit_count: number };
    self_log?: unknown[];
};

function renderDoorway(page: CountPayload) {
    const visitCount = page.self_log?.length ?? page.personal.visit_count ?? 0;
    return render(
        <View>
            {shouldShowHistoryDoorway(visitCount, 'restaurant') ? (
                <YourHistoryDoorway
                    restaurantName="Kiln"
                    visitCount={visitCount}
                    onPress={jest.fn()}
                    palette={Colors.light}
                />
            ) : null}
        </View>,
    );
}

describe('YourHistoryDoorway', () => {
    it('gates on both a persisted id and at least one self log', () => {
        expect(shouldShowHistoryDoorway(0, 'restaurant')).toBe(false);
        expect(shouldShowHistoryDoorway(1, null)).toBe(false);
        expect(shouldShowHistoryDoorway(1, 'restaurant')).toBe(true);
    });

    it('pluralises and exposes the doorway as one accessible button', () => {
        const onPress = jest.fn();
        const screen = render(
            <YourHistoryDoorway
                restaurantName="Kiln"
                visitCount={1}
                onPress={onPress}
                palette={Colors.light}
            />,
        );
        fireEvent.press(screen.getByLabelText('your history, 1 visit'));
        expect(onPress).toHaveBeenCalledTimes(1);
        expect(screen.getByText("you've been here · 1 visit")).toBeTruthy();
    });

    it('uses the complete self log instead of the rated-only personal count', () => {
        const screen = renderDoorway({
            personal: { visit_count: 3 },
            self_log: Array.from({ length: 5 }, (_, index) => ({ id: `self-${index}` })),
        });

        expect(screen.getByText("you've been here · 5 visits")).toBeTruthy();
    });

    it('uses the compatible personal count when a legacy server omits self_log', () => {
        const screen = renderDoorway({ personal: { visit_count: 7 } });

        expect(screen.getByText("you've been here · 7 visits")).toBeTruthy();
    });

    it('treats an authoritative empty self_log as zero and hides the doorway', () => {
        const screen = renderDoorway({ personal: { visit_count: 3 }, self_log: [] });

        expect(screen.queryByText(/you've been here/)).toBeNull();
    });
});
