/**
 * ImportAttentionCard tests (TICKET-191 rev 2) — the render matrix against the
 * REAL deriveImportSlot ladder: the four attention tiers (review / failed /
 * kickoff / digest-with-needsLook) render the card, the calm tiers (running /
 * digest-clean / recent) and idle render nothing, and the tap routes via the
 * hub.
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
        StyleSheet: { create: (styles: unknown) => styles },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/components/ui/napkin/PressableScale', () => ({
    PressableScale: (props: Record<string, unknown>) =>
        require('react').createElement('PressableScale', props, props.children),
}));

import { ImportAttentionCard } from '../ImportAttentionCard';
import { deriveImportSlot, type ImportSlot } from '@/hooks/imports/importSlotUtils';
import type { ActiveImport, ActiveLargeImport } from '@/hooks/wishlist/useActiveImports';
import type { RecentImport } from '@/hooks/wishlist/useRecentImports';

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

function active(phase: ActiveImport['phase'], spotCount = 0): ActiveImport {
    return { jobId: `j-${phase}-${spotCount}`, phase, spotCount } as unknown as ActiveImport;
}

function largeJob(
    largePhase: ActiveLargeImport['phase'],
    over: Partial<ActiveLargeImport> = {},
): ActiveImport {
    const large: ActiveLargeImport = {
        phase: largePhase,
        cursor: 0,
        listCount: 0,
        title: null,
        imported: 0,
        needsLook: 0,
        ...over,
    };
    const phase =
        largePhase === 'kickoff' ? 'kickoff' : largePhase === 'done' ? 'review' : 'saving';
    return { jobId: `lg-${largePhase}`, phase, spotCount: large.listCount, large } as unknown as ActiveImport;
}

function recentBatch(): RecentImport {
    return {
        job_id: 'r1',
        source: null,
        status: 'done',
        created_at: new Date(NOW).toISOString(),
        item_count: 3,
        preview_names: [],
    };
}

function render(slot: ImportSlot | null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(<ImportAttentionCard slot={slot} />);
    });
    return renderer;
}

describe('ImportAttentionCard', () => {
    beforeEach(() => mockPush.mockReset());

    const attentionSlots: Array<[string, ImportSlot | null]> = [
        ['review', deriveImportSlot([active('review', 4)], [], NOW)],
        ['failed', deriveImportSlot([active('failed')], [], NOW)],
        ['kickoff', deriveImportSlot([largeJob('kickoff', { listCount: 117 })], [], NOW)],
        ['digest-needsLook', deriveImportSlot([largeJob('done', { imported: 20, needsLook: 3 })], [], NOW)],
    ];

    const calmSlots: Array<[string, ImportSlot | null]> = [
        ['running', deriveImportSlot([active('reading')], [], NOW)],
        ['digest-clean', deriveImportSlot([largeJob('done', { imported: 12, needsLook: 0 })], [], NOW)],
        ['recent', deriveImportSlot([], [recentBatch()], NOW)],
        ['idle', null],
    ];

    it.each(attentionSlots)('renders the card for the %s attention tier', (_name, slot) => {
        expect(slot?.accent).toBe('attention');
        const renderer = render(slot);
        const cards = renderer.root.findAllByType('PressableScale');
        expect(cards).toHaveLength(1);
        expect(cards[0].props.accessibilityLabel).toBe(slot!.title);
        act(() => renderer.unmount());
    });

    it.each(calmSlots)('renders nothing for the %s state', (_name, slot) => {
        if (slot) expect(slot.accent).toBe('calm');
        const renderer = render(slot);
        expect(renderer.toJSON()).toBeNull();
        act(() => renderer.unmount());
    });

    it('routes the tap via the imports hub', () => {
        const renderer = render(deriveImportSlot([active('review', 4)], [], NOW));
        const [card] = renderer.root.findAllByType('PressableScale');
        act(() => card.props.onPress());
        expect(mockPush).toHaveBeenCalledWith('/import-progress');
        act(() => renderer.unmount());
    });
});
