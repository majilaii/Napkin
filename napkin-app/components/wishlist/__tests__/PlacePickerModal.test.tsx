/* eslint-disable import/first */
import React from 'react';
// @ts-expect-error react-test-renderer has no types in this project.
import TestRenderer, { act } from 'react-test-renderer';
import { Colors } from '@/constants/theme';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockEdge = jest.fn();
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
    FlatList: 'FlatList', Modal: 'Modal', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 }, Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: (...args: any[]) => mockEdge(...args) }));
import { PlacePickerModal } from '../PlacePickerModal';
let renderer: any;
function render() {
    act(() => { renderer = TestRenderer.create(<PlacePickerModal visible title="Find place" initialQuery="Posada" city="Espinosa de los Monteros" onSelect={jest.fn()} onDismiss={jest.fn()} palette={Colors.light} />); });
}
beforeEach(() => { jest.useFakeTimers(); mockEdge.mockReset().mockResolvedValue([]); });
afterEach(() => { act(() => renderer?.unmount()); jest.useRealTimers(); });
it('debounces edits and preserves the imported town in the paid search', async () => {
    render();
    act(() => renderer.root.findByProps({ accessibilityLabel: 'search for the correct place' }).props.onChangeText('Posada Real'));
    await act(async () => { jest.advanceTimersByTime(299); });
    expect(mockEdge).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(mockEdge).toHaveBeenCalledTimes(1);
    expect(mockEdge).toHaveBeenCalledWith('places-search', { body: { query: 'Posada Real', city: 'Espinosa de los Monteros', limit: 8 } });
});
it('renders search failure separately from an empty successful result', async () => {
    mockEdge.mockRejectedValueOnce(new Error('offline'));
    render();
    await act(async () => { jest.advanceTimersByTime(300); });
    const empty = renderer.root.findByType('FlatList').props.ListEmptyComponent;
    expect(empty.props.children[0].props.children).toBe('Could not search places.');
    act(() => empty.props.children[1].props.onPress());
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(renderer.root.findByType('FlatList').props.ListEmptyComponent.props.children[0].props.children).toBe('No places found. Try another name or town.');
});
it('cancels pending paid requests when the picker closes', async () => {
    render();
    act(() => { renderer.update(<PlacePickerModal visible={false} title="Find place" initialQuery="Posada" onSelect={jest.fn()} onDismiss={jest.fn()} palette={Colors.light} />); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockEdge).not.toHaveBeenCalled();
});
