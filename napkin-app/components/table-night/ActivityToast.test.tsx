/* eslint-disable import/first */
import React from 'react';
// @ts-expect-error react-test-renderer has no declarations
import TestRenderer, { act } from 'react-test-renderer';
const mockScreenReader = jest.fn().mockResolvedValue(false);
let mockOwner = 'alice';
jest.mock('react-native', () => ({
    View: 'View', Text: 'Text', Pressable: 'Pressable',
    Platform: { OS: 'ios', select: (v: any) => v.ios },
    StyleSheet: { create: (v: unknown) => v },
    AccessibilityInfo: { isScreenReaderEnabled: () => mockScreenReader() },
    Animated: { View: 'AnimatedView', Value: class { stopAnimation() {} }, timing: () => ({ start: (fn?: () => void) => fn?.() }) },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: mockOwner } } }) }));
import { ToastProvider, useToast } from '@/providers/ToastProvider';
import { ACTION_TOAST_DURATION_MS, TOAST_DURATION_MS } from './ActivityToast';
let api: ReturnType<typeof useToast>;
function Child() { api = useToast(); return null; }
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let tree: any;
beforeEach(async () => {
    jest.useFakeTimers(); mockOwner = 'alice'; mockScreenReader.mockResolvedValue(false);
    await act(async () => { tree = TestRenderer.create(<ToastProvider><Child /></ToastProvider>); });
});
afterEach(async () => { await act(async () => tree.unmount()); jest.useRealTimers(); });
const buttons = () => tree.root.findAllByType('Pressable');
it('the whole actionable notice invokes its action exactly once', async () => {
    const open = jest.fn();
    await act(async () => api.show('3 spots ready', { label: 'Review spots', onPress: open }, { title: 'Imports', icon: 'bookmarks-outline' }));
    const notice = buttons().find((b: any) => b.props.accessibilityLabel.includes('Review spots'));
    await act(async () => { notice.props.onPress(); notice.props.onPress(); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(buttons()).toHaveLength(0);
});
it('dismissal never runs the action', async () => {
    const open = jest.fn();
    await act(async () => api.show('3 spots ready', { label: 'Review spots', onPress: open }));
    await act(async () => buttons().find((b: any) => b.props.accessibilityLabel === 'Dismiss notification').props.onPress());
    expect(open).not.toHaveBeenCalled();
});
it('queued notices get their own full lifetime after becoming visible', async () => {
    await act(async () => { api.show('first'); api.show('second', { label: 'Open', onPress: jest.fn() }); });
    await act(async () => jest.advanceTimersByTime(TOAST_DURATION_MS));
    expect(buttons().some((b: any) => b.props.accessibilityLabel.includes('second'))).toBe(true);
    await act(async () => jest.advanceTimersByTime(ACTION_TOAST_DURATION_MS - 1));
    expect(buttons()).toHaveLength(2);
    await act(async () => jest.advanceTimersByTime(1));
    expect(buttons()).toHaveLength(0);
});
it('keeps actions available to a screen reader until explicitly dismissed', async () => {
    mockScreenReader.mockResolvedValue(true);
    await act(async () => api.show('ready', { label: 'Open', onPress: jest.fn() }));
    await act(async () => jest.advanceTimersByTime(60000));
    expect(buttons()).toHaveLength(2);
});
it('clears notices when the account changes', async () => {
    await act(async () => api.show('Alice private import', { label: 'Open', onPress: jest.fn() }));
    mockOwner = 'bob';
    await act(async () => tree.update(<ToastProvider><Child /></ToastProvider>));
    expect(buttons()).toHaveLength(0);
});
