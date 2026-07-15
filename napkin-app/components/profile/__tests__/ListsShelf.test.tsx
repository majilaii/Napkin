/* eslint-disable @typescript-eslint/no-require-imports, import/first */
/**
 * ListsShelf section-header tests (TICKET-191 rev 2) — after the Collections
 * un-merge, the shelf owns its "Lists" section again: exactly ONE
 * SectionHeader renders per variant (self with lists, self empty/ghost,
 * stranger with public lists), and none while lists are unresolved or for a
 * stranger with no public lists.
 *
 * Component imports sit below the mocks: the useMyLists factory reads
 * mockMyLists, so importing first would hit its TDZ.
 */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockMyLists: unknown[] | undefined;

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
        ScrollView: host('ScrollView'),
        StyleSheet: {
            absoluteFill: { position: 'absolute' },
            hairlineWidth: 1,
            create: (styles: unknown) => styles,
        },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    };
});
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/lists/useMyLists', () => ({
    useMyLists: () => ({ data: mockMyLists }),
}));
jest.mock('@/components/ui/napkin/PressableScale', () => ({
    PressableScale: (props: Record<string, unknown>) =>
        require('react').createElement('PressableScale', props, props.children),
}));
jest.mock('../SectionHeader', () => ({
    SectionHeader: (props: Record<string, unknown>) =>
        require('react').createElement('SectionHeader', props),
}));

import { ListsShelf } from '../ListsShelf';
import type { MyList } from '@/hooks/lists/useMyLists';
import type { ProfileListSummary } from '@/hooks/users/useUserProfile';

const MY_LIST: MyList = {
    id: 'list-1',
    owner_id: 'user-1',
    title: 'Date nights',
    description: null,
    ranked: false,
    privacy: 'private',
    emoji: '🕯️',
    entry_count: 4,
    cover_photo_url: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
};

const PUBLIC_LIST: ProfileListSummary = {
    id: 'list-2',
    title: 'Ramen crawl',
    entry_count: 6,
    ranked: false,
    privacy: 'public',
    updated_at: '2026-07-01T00:00:00Z',
    cover_photo_url: null,
};

function render(props: Partial<React.ComponentProps<typeof ListsShelf>> = {}) {
     
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <ListsShelf isSelf userId="user-1" publicLists={[]} {...props} />,
        );
    });
    return renderer;
}

 
function headers(renderer: any) {
    return renderer.root.findAllByType('SectionHeader');
}

function attributionCredits(renderer: any) {
    return renderer.root.findAllByType('Text').filter(
        (node: any) => node.props.testID === 'list-cover-attribution',
    );
}

describe('ListsShelf section header (rev 2 un-merge)', () => {
    it('renders the parsed credit over an attributed Places cover', () => {
        mockMyLists = [{
            ...MY_LIST,
            cover_photo_url: 'https://cdn.example/places.jpg',
            cover_photo_source: 'places',
            cover_attribution_html: '<a href="https://maps.example/jane">Jane Doe</a>',
        }];
        const renderer = render();
        const credits = attributionCredits(renderer);

        expect(renderer.root.findAllByType('Image')).toHaveLength(1);
        expect(credits).toHaveLength(1);
        expect(credits[0].children.join('')).toBe('Jane Doe');
        expect(credits[0].props.numberOfLines).toBe(1);

        const image = renderer.root.findByType('Image');
        act(() => image.props.onError());
        expect(renderer.root.findAllByType('Image')).toHaveLength(0);
        expect(attributionCredits(renderer)).toHaveLength(0);

        act(() => renderer.unmount());
    });

    it('renders a known non-Places cover without a credit', () => {
        mockMyLists = [{
            ...MY_LIST,
            cover_photo_url: 'https://cdn.example/user.jpg',
            cover_photo_source: 'user',
            cover_attribution_html: null,
        }];
        const renderer = render();

        expect(renderer.root.findAllByType('Image')).toHaveLength(1);
        expect(attributionCredits(renderer)).toHaveLength(0);

        act(() => renderer.unmount());
    });

    it('suppresses a Places cover when attribution is missing', () => {
        mockMyLists = [{
            ...MY_LIST,
            cover_photo_url: 'https://cdn.example/uncredited.jpg',
            cover_photo_source: 'places',
            cover_attribution_html: null,
        }];
        const renderer = render();

        expect(renderer.root.findAllByType('Image')).toHaveLength(0);
        expect(attributionCredits(renderer)).toHaveLength(0);

        act(() => renderer.unmount());
    });

    it('ignores a late image error from a shelf cover that was already replaced', () => {
        mockMyLists = [{
            ...MY_LIST,
            cover_photo_url: 'https://cdn.example/old.jpg',
            cover_photo_source: 'places',
            cover_attribution_html: '<a href="https://maps.example/old">Old credit</a>',
        }];
        const renderer = render();
        const failOldCover = renderer.root.findByType('Image').props.onError;

        mockMyLists = [{
            ...MY_LIST,
            cover_photo_url: 'https://cdn.example/new.jpg',
            cover_photo_source: 'places',
            cover_attribution_html: '<a href="https://maps.example/new">New credit</a>',
        }];
        act(() => {
            renderer.update(<ListsShelf isSelf userId="user-1" publicLists={[]} />);
        });
        act(() => failOldCover());

        expect(renderer.root.findByType('Image').props.source).toEqual({
            uri: 'https://cdn.example/new.jpg',
        });
        expect(attributionCredits(renderer)[0].children.join('')).toBe('New credit');

        act(() => renderer.unmount());
    });

    it('renders exactly one "Lists" header for self with lists (+ see all)', () => {
        mockMyLists = [MY_LIST];
        const renderer = render();
        const found = headers(renderer);
        expect(found).toHaveLength(1);
        expect(found[0].props.title).toBe('Lists');
        expect(found[0].props.rightLabel).toBe('see all');
        act(() => renderer.unmount());
    });

    it('renders exactly one header over the ghost card for self with none', () => {
        mockMyLists = [];
        const renderer = render();
        const found = headers(renderer);
        expect(found).toHaveLength(1);
        expect(found[0].props.rightLabel).toBeUndefined();
        act(() => renderer.unmount());
    });

    it('renders nothing (no header flash) while self lists are unresolved', () => {
        mockMyLists = undefined;
        const renderer = render();
        expect(renderer.toJSON()).toBeNull();
        act(() => renderer.unmount());
    });

    it('renders exactly one header for a stranger with public lists, none without', () => {
        mockMyLists = undefined;
        const withLists = render({ isSelf: false, publicLists: [PUBLIC_LIST] });
        expect(headers(withLists)).toHaveLength(1);
        expect(headers(withLists)[0].props.title).toBe('Lists');
        act(() => withLists.unmount());

        const withoutLists = render({ isSelf: false, publicLists: [] });
        expect(withoutLists.toJSON()).toBeNull();
        act(() => withoutLists.unmount());
    });
});
