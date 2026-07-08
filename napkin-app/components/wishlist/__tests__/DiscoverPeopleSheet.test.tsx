/**
 * DiscoverPeopleSheet draft-apply tests (TICKET-147 review round).
 *
 * Pins the mechanism that kills the multi-select bug by construction: while the
 * sheet is open, toggles mutate a LOCAL draft only — `onApply` fires exactly
 * once, on dismiss — so the always-mounted map never reconciles markers under
 * the open Modal.
 *
 * jest.setup.js globally stubs react-native with a component-less mock, so this
 * file installs a file-local realistic mock (Pressable invokes onPress, Modal
 * renders children when visible) to render the REAL sheet JSX.
 */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types (React 19, no @types
// package installed); used here as an untyped runtime harness — helpers below
// annotate `any` deliberately.
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native', () => {
    const React = require('react');
    const mk = (name: string) => {
        const C = (props: any) => React.createElement(name, props, props.children);
        C.displayName = name;
        return C;
    };
    return {
        Platform: { OS: 'ios', select: (o: any) => o.ios },
        StyleSheet: { create: (s: any) => s },
        View: mk('View'),
        Text: mk('Text'),
        ScrollView: mk('ScrollView'),
        TextInput: mk('TextInput'),
        Modal: (props: any) => (props.visible ? React.createElement('Modal', props, props.children) : null),
        Pressable: mk('Pressable'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: (p: any) => require('react').createElement('Icon', p) }));
jest.mock('expo-image', () => ({ Image: (p: any) => require('react').createElement('Img', p) }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { DiscoverPeopleSheet } from '../DiscoverPeopleSheet';
import { Colors } from '@/constants/theme';

const people = [
    { id: 'ada', name: 'Ada', avatar: null },
    { id: 'bob', name: 'Bob', avatar: null },
    { id: 'cai', name: 'Cai', avatar: null },
];

function renderSheet(over: Partial<React.ComponentProps<typeof DiscoverPeopleSheet>> = {}) {
    const onApply = jest.fn();
    const onDismiss = jest.fn();
    let root: any;
    const props: React.ComponentProps<typeof DiscoverPeopleSheet> = {
        visible: true,
        onDismiss,
        onApply,
        palette: Colors.light,
        people,
        checkedIds: new Set<string>(),
        ...over,
    };
    act(() => {
        root = TestRenderer.create(<DiscoverPeopleSheet {...props} />);
    });
    return { root, onApply, onDismiss, props };
}

function row(root: any, label: string) {
    return root.root.findAll(
        (n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label,
    )[0];
}

function press(root: any, label: string) {
    act(() => row(root, label).props.onPress());
}

function selectedLabels(root: any): string[] {
    // Component + host node both match — dedupe via a Set.
    return [
        ...new Set<string>(
            root.root
                .findAll(
                    (n: any) =>
                        n.props.accessibilityRole === 'button' &&
                        n.props.accessibilityState?.selected === true,
                )
                .map((n: any) => n.props.accessibilityLabel as string),
        ),
    ];
}

function dismiss(root: any) {
    const modal = root.root.findAll((n: any) => n.type === 'Modal')[0];
    act(() => modal.props.onRequestClose());
}

it('toggles accumulate in the DRAFT; onApply fires once, on dismiss, with the full set', () => {
    const { root, onApply, onDismiss } = renderSheet();
    press(root, 'Bob');
    press(root, 'Cai');
    expect(selectedLabels(root).sort()).toEqual(['Bob', 'Cai']);
    // Draft-apply: nothing applied to the map yet.
    expect(onApply).not.toHaveBeenCalled();
    dismiss(root);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect([...onApply.mock.calls[0][0]].sort()).toEqual(['bob', 'cai']);
    expect(onDismiss).toHaveBeenCalledTimes(1);
});

it('Everyone clears the draft and stays open; dismissal applies the empty set', () => {
    const { root, onApply, onDismiss } = renderSheet({ checkedIds: new Set(['bob']) });
    // Seeded from the applied set.
    expect(selectedLabels(root)).toEqual(['Bob']);
    press(root, 'everyone');
    expect(selectedLabels(root)).toEqual(['everyone']);
    expect(onApply).not.toHaveBeenCalled(); // still open, nothing applied
    expect(onDismiss).not.toHaveBeenCalled();
    dismiss(root);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].size).toBe(0);
});

it('un-toggling removes from the draft; count line narrates the draft live', () => {
    const countFor = jest.fn((s: ReadonlySet<string>) => `n=${s.size}`);
    const { root, onApply } = renderSheet({ countFor });
    press(root, 'Ada');
    press(root, 'Bob');
    press(root, 'Ada'); // un-toggle
    expect(selectedLabels(root)).toEqual(['Bob']);
    // The count line re-rendered against the draft each time (last call = size 1).
    expect(countFor).toHaveBeenLastCalledWith(expect.any(Set));
    expect(countFor.mock.calls[countFor.mock.calls.length - 1][0].size).toBe(1);
    dismiss(root);
    expect([...onApply.mock.calls[0][0]]).toEqual(['bob']);
});

it('a "your table" row drafts exactly that member set', () => {
    const { root, onApply } = renderSheet({
        tableRows: [{ tableId: 't1', name: 'The Table', memberIds: ['ada', 'cai'] }],
    });
    press(root, 'The Table');
    expect(selectedLabels(root).sort()).toEqual(['Ada', 'Cai', 'The Table']);
    dismiss(root);
    expect([...onApply.mock.calls[0][0]].sort()).toEqual(['ada', 'cai']);
});

it('re-opening seeds the draft from the applied set (no stale draft)', () => {
    const { root, props, onApply } = renderSheet();
    press(root, 'Bob');
    dismiss(root);
    // Parent closes + later re-opens with a different applied set.
    act(() => {
        root.update(<DiscoverPeopleSheet {...props} visible={false} />);
    });
    act(() => {
        root.update(<DiscoverPeopleSheet {...props} visible checkedIds={new Set(['cai'])} />);
    });
    expect(selectedLabels(root)).toEqual(['Cai']);
    expect(onApply).toHaveBeenCalledTimes(1); // only the earlier dismiss applied
});
