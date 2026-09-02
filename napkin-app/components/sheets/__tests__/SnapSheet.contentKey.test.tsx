import React from 'react';
import { act, render } from '@testing-library/react-native';

import {
    SnapSheet,
    type SnapSheetContentContext,
    type SnapSheetHandle,
} from '../SnapSheet';
import { FULL, PEEK, PLACES_SNAP_METRICS } from '../snapSheetMath';

type GestureHandlers = {
    onBegin?: () => void;
    onUpdate?: (event: { translationY: number }) => void;
    onFinalize?: (event: { velocityY: number }) => void;
};

const mockGesturePans: { handlers: GestureHandlers }[] = [];

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children as React.ReactNode);
    return {
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        StyleSheet: { create: (styles: unknown) => styles },
        View: host('View'),
    };
});

jest.mock('react-native-reanimated', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children as React.ReactNode);
    return {
        __esModule: true,
        default: { View: host('AnimatedView') },
        runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
        runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
        useAnimatedScrollHandler: (handler: (event: { contentOffset: { y: number } }) => void) => handler,
        useAnimatedStyle: (factory: () => unknown) => factory(),
        useSharedValue: (value: unknown) => ReactModule.useRef({ value }).current,
        withSpring: (
            value: unknown,
            _config: unknown,
            callback?: (finished: boolean) => void,
        ) => {
            callback?.(true);
            return value;
        },
        withTiming: (value: unknown) => value,
    };
});

jest.mock('react-native-gesture-handler', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const chain = (handlers: GestureHandlers) => {
        const gesture = {
            activeOffsetY: () => gesture,
            enabled: () => gesture,
            simultaneousWithExternalGesture: () => gesture,
            onBegin: (handler: GestureHandlers['onBegin']) => {
                handlers.onBegin = handler;
                return gesture;
            },
            onStart: () => gesture,
            onUpdate: (handler: GestureHandlers['onUpdate']) => {
                handlers.onUpdate = handler;
                return gesture;
            },
            onFinalize: (handler: GestureHandlers['onFinalize']) => {
                handlers.onFinalize = handler;
                return gesture;
            },
        };
        return gesture;
    };
    return {
        Gesture: {
            Native: () => ({}),
            Pan: () => {
                const pan = { handlers: {} };
                mockGesturePans.push(pan);
                return chain(pan.handlers);
            },
            Simultaneous: (...gestures: unknown[]) => gestures,
        },
        GestureDetector: ({ children }: { children: React.ReactNode }) =>
            ReactModule.createElement(ReactModule.Fragment, null, children),
    };
});

function latestListPan(): GestureHandlers {
    return mockGesturePans[mockGesturePans.length - 2].handlers;
}

describe('SnapSheet content handoff reset', () => {
    beforeEach(() => {
        mockGesturePans.length = 0;
    });

    it('collapses after scrolled Places is replaced by People at the top', () => {
        const sheetRef = React.createRef<SnapSheetHandle>();
        const onSettle = jest.fn();
        let contentContext: SnapSheetContentContext | null = null;
        const node = (contentKey: string, contentName: string) => (
            <SnapSheet
                H={800}
                initialSnap={FULL}
                sheetRef={sheetRef}
                onSettle={onSettle}
                metrics={PLACES_SNAP_METRICS}
                contentKey={contentKey}
                renderContent={(context) => {
                    contentContext = context;
                    return React.createElement(contentName);
                }}
            />
        );
        const screen = render(node('places:results', 'PlacesResults'));
        onSettle.mockClear();

        act(() => {
            const onScroll = contentContext!.onScroll as unknown as (
                event: { contentOffset: { y: number } },
            ) => void;
            onScroll({ contentOffset: { y: 400 } });
        });
        screen.rerender(node('people:guidance', 'PeopleGuidance'));

        const pan = latestListPan();
        act(() => {
            pan.onBegin?.();
            pan.onUpdate?.({ translationY: 100 });
            pan.onFinalize?.({ velocityY: 2000 });
        });

        expect(onSettle).toHaveBeenCalledWith(PEEK, 250);
        expect(sheetRef.current?.currentSnap()).toBe(PEEK);
    });

    it('collapses after a scrolled Lists query is replaced by a new query at the top', () => {
        const sheetRef = React.createRef<SnapSheetHandle>();
        const onSettle = jest.fn();
        let contentContext: SnapSheetContentContext | null = null;
        const node = (contentKey: string) => (
            <SnapSheet
                H={800}
                initialSnap={FULL}
                sheetRef={sheetRef}
                onSettle={onSettle}
                metrics={PLACES_SNAP_METRICS}
                contentKey={contentKey}
                renderContent={(context) => {
                    contentContext = context;
                    return React.createElement('ListsResults');
                }}
            />
        );
        const screen = render(node('lists:results:brat'));
        onSettle.mockClear();

        act(() => {
            const onScroll = contentContext!.onScroll as unknown as (
                event: { contentOffset: { y: number } },
            ) => void;
            onScroll({ contentOffset: { y: 400 } });
        });
        // Same segment + branch, different debounced query ⇒ the list remounts at the top.
        screen.rerender(node('lists:results:kiln'));

        const pan = latestListPan();
        act(() => {
            pan.onBegin?.();
            pan.onUpdate?.({ translationY: 100 });
            pan.onFinalize?.({ velocityY: 2000 });
        });

        expect(onSettle).toHaveBeenCalledWith(PEEK, 250);
        expect(sheetRef.current?.currentSnap()).toBe(PEEK);
    });

    it('remounts the content surface when contentKey changes (and not otherwise)', () => {
        let mounts = 0;
        function Probe() {
            React.useEffect(() => {
                mounts += 1;
            }, []);
            return null;
        }
        const sheetRef = React.createRef<SnapSheetHandle>();
        const node = (contentKey: string) => (
            <SnapSheet
                H={800}
                initialSnap={FULL}
                sheetRef={sheetRef}
                onSettle={jest.fn()}
                metrics={PLACES_SNAP_METRICS}
                contentKey={contentKey}
                renderContent={() => <Probe />}
            />
        );
        const screen = render(node('people:results:a'));
        expect(mounts).toBe(1);
        screen.rerender(node('people:results:a'));
        expect(mounts).toBe(1);
        screen.rerender(node('people:results:b'));
        expect(mounts).toBe(2);
    });

    it('keeps ListDetailSheet parity when contentKey is omitted', () => {
        const sheetRef = React.createRef<SnapSheetHandle>();
        const onSettle = jest.fn();
        let contentContext: SnapSheetContentContext | null = null;
        const node = (contentName: string) => (
            <SnapSheet
                H={800}
                initialSnap={FULL}
                sheetRef={sheetRef}
                onSettle={onSettle}
                renderContent={(context) => {
                    contentContext = context;
                    return React.createElement(contentName);
                }}
            />
        );
        const screen = render(node('ListDetailRows'));
        onSettle.mockClear();

        act(() => {
            const onScroll = contentContext!.onScroll as unknown as (
                event: { contentOffset: { y: number } },
            ) => void;
            onScroll({ contentOffset: { y: 400 } });
        });
        screen.rerender(node('ListDetailReplacement'));

        const pan = latestListPan();
        act(() => {
            pan.onBegin?.();
            pan.onUpdate?.({ translationY: 100 });
            pan.onFinalize?.({ velocityY: 2000 });
        });

        expect(onSettle).not.toHaveBeenCalled();
        expect(sheetRef.current?.currentSnap()).toBe(FULL);
    });
});
