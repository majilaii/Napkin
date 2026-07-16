/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import type { SocialsCard } from '@/hooks/feed/useSocials';
import type { PublicListResult } from '@/hooks/lists/useSearchPublicLists';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Linking: { openURL: jest.fn(() => Promise.resolve()) },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        ScrollView: host('ScrollView'),
        StyleSheet: {
            absoluteFillObject: { position: 'absolute', inset: 0 },
            hairlineWidth: 1,
            create: (styles: unknown) => styles,
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/components/ui/napkin/PressableScale', () => ({
    PressableScale: (props: Record<string, unknown>) =>
        require('react').createElement('PressableScale', props, props.children),
}));
jest.mock('../SectionKicker', () => ({ SectionKicker: 'SectionKicker' }));

import { OnSocialsBlock } from '../OnSocialsBlock';
import { PublicListsBrowseBlock } from '../PublicListsBrowseBlock';

function textContent(node: any): string {
    return node.children
        .map((child: any) => typeof child === 'string' ? child : textContent(child))
        .join('');
}

function hostCredit(renderer: any, testID: string) {
    return renderer.root.findAllByProps({ testID }).find((node: any) => node.type === 'Text');
}

function social(id: string, author: string): SocialsCard {
    return {
        restaurant_id: id,
        name: `Restaurant ${id}`,
        neighborhood: null,
        rung: 1,
        window: 'week',
        count: 3,
        platform: 'socials',
        creator_handle: null,
        thumb_url: null,
        photo_url: `https://images.test/${id}.jpg`,
        photo_source: 'places',
        attribution_html: author,
    };
}

function list(id: string, author: string): PublicListResult {
    return {
        id,
        owner_id: `owner-${id}`,
        title: `List ${id}`,
        description: null,
        ranked: false,
        emoji: null,
        entry_count: 4,
        updated_at: '2026-07-15T12:00:00.000Z',
        owner_display_name: 'Mara',
        owner_avatar_url: null,
        owner_username: 'mara',
        cover_photo_url: `https://images.test/list-${id}.jpg`,
        photo_source: 'places',
        attribution_html: author,
    };
}

it('aggregates the socials rail into one off-image line and updates after image failure', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <OnSocialsBlock cards={[
                social('one', 'Jane Doe'),
                social('two', '  JANE   DOE '),
                social('three', 'Marco'),
            ]} />,
        );
    });

    const credit = hostCredit(renderer, 'socials-places-credit');
    expect(textContent(credit)).toBe('photos · Jane Doe, Marco');
    expect(renderer.root.findAllByProps({ testID: 'socials-places-credit' })
        .filter((node: any) => node.type === 'Text')).toHaveLength(1);
    for (const image of renderer.root.findAllByType('Image')) {
        expect(image.parent.findAllByProps({ testID: 'socials-places-credit' })).toHaveLength(0);
    }

    act(() => renderer.root.findAllByType('Image')[2].props.onError());
    expect(textContent(hostCredit(renderer, 'socials-places-credit'))).toBe('photos · Jane Doe');
    act(() => renderer.unmount());
});

it('aggregates public-list covers once outside every image block and fails malformed covers closed', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <PublicListsBrowseBlock lists={[
                list('one', 'Jane Doe'),
                list('two', ' jane   doe '),
                list('three', 'Marco'),
                { ...list('missing', 'Ignored'), attribution_html: null },
            ]} />,
        );
    });

    expect(renderer.root.findAllByType('Image')).toHaveLength(3);
    expect(textContent(hostCredit(renderer, 'public-lists-places-credit')))
        .toBe('photos · Jane Doe, Marco');
    expect(renderer.root.findAllByProps({ testID: 'public-lists-places-credit' })
        .filter((node: any) => node.type === 'Text')).toHaveLength(1);
    for (const image of renderer.root.findAllByType('Image')) {
        expect(image.parent.findAllByProps({ testID: 'public-lists-places-credit' }))
            .toHaveLength(0);
    }

    act(() => renderer.root.findAllByType('Image')[2].props.onError());
    expect(textContent(hostCredit(renderer, 'public-lists-places-credit')))
        .toBe('photos · Jane Doe');
    act(() => renderer.unmount());
});
