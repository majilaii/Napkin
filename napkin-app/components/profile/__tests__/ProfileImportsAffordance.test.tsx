/* eslint-disable @typescript-eslint/no-require-imports, import/first */
/**
 * ProfileImportsAffordance tests (TICKET-191 rev 2) — the header tray badge
 * states. Slots come from the REAL deriveImportSlot so the badge logic is
 * proven against the actual ladder: attention-with-count (review) shows the
 * headline count, attention-without-count (failed) shows a dot, calm shows
 * nothing, and every tap routes via the hub.
 *
 * Component imports sit below the mocks: the expo-router factory reads
 * mockPush, so importing first would hit its TDZ.
 */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => {
        const Component = (props: Record<string, unknown>) =>
            ReactModule.createElement(name, props, props.children);
        Component.displayName = name;
        return Component;
    };
    return {
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        StyleSheet: { create: (styles: unknown) => styles },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

import { ProfileImportsAffordance } from '../ProfileImportsAffordance';
import { deriveImportSlot, type ImportSlot } from '@/hooks/imports/importSlotUtils';
import type { ActiveImport } from '@/hooks/wishlist/useActiveImports';

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

function active(phase: ActiveImport['phase'], spotCount = 0): ActiveImport {
    return { jobId: `j-${phase}-${spotCount}`, phase, spotCount } as unknown as ActiveImport;
}

function slotFor(imports: ActiveImport[]): ImportSlot | null {
    return deriveImportSlot(imports, [], NOW);
}

function render(slot: ImportSlot | null) {
     
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(<ProfileImportsAffordance slot={slot} />);
    });
    return renderer;
}

function byTestId(renderer: ReturnType<typeof render>, testID: string) {
    // Host nodes only — the react-native mock's function components carry the
    // same props, so an untyped match would double-count every element.
     
    return renderer.root.findAll(
        (node: any) => typeof node.type === 'string' && node.props?.testID === testID,
    );
}

describe('ProfileImportsAffordance', () => {
    beforeEach(() => mockPush.mockReset());

    it('shows the headline count badge for an attention slot that carries one (review)', () => {
        const slot = slotFor([active('review', 2), active('review', 3)]);
        expect(slot).toMatchObject({ kind: 'review', accent: 'attention', count: 5 });
        const renderer = render(slot);

        const badge = byTestId(renderer, 'imports-badge-count');
        expect(badge).toHaveLength(1);
        expect(renderer.root.findAllByType('Text').map((t: { props: { children: unknown } }) => t.props.children)).toContain('5');
        expect(byTestId(renderer, 'imports-badge-dot')).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('shows a dot for an attention slot without a headline count (failed)', () => {
        const slot = slotFor([active('failed')]);
        expect(slot).toMatchObject({ kind: 'failed', accent: 'attention', count: null });
        const renderer = render(slot);

        expect(byTestId(renderer, 'imports-badge-dot')).toHaveLength(1);
        expect(byTestId(renderer, 'imports-badge-count')).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('shows no badge for a calm slot (running) or when idle', () => {
        const calm = slotFor([active('reading')]);
        expect(calm).toMatchObject({ kind: 'working', accent: 'calm' });
        for (const slot of [calm, null]) {
            const renderer = render(slot);
            expect(byTestId(renderer, 'imports-badge-count')).toHaveLength(0);
            expect(byTestId(renderer, 'imports-badge-dot')).toHaveLength(0);
            // The tray itself is the standing affordance — always present.
            expect(byTestId(renderer, 'profile-imports-affordance')).toHaveLength(1);
            act(() => renderer.unmount());
        }
    });

    it('routes every tap via the imports hub and labels itself', () => {
        const renderer = render(slotFor([active('review', 1)]));
        const [pressable] = byTestId(renderer, 'profile-imports-affordance');

        expect(pressable.props.accessibilityRole).toBe('button');
        expect(pressable.props.accessibilityLabel).toBe('Imports — 1 spot ready to review');
        act(() => pressable.props.onPress());
        expect(mockPush).toHaveBeenCalledWith('/import-progress');
        act(() => renderer.unmount());

        const idle = render(null);
        expect(byTestId(idle, 'profile-imports-affordance')[0].props.accessibilityLabel).toBe('Imports');
        act(() => idle.unmount());
    });
});
