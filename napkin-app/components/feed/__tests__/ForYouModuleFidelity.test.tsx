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
        Image: host('Image'),
        Linking: { openURL: jest.fn(() => Promise.resolve()) },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        Pressable: host('Pressable'),
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
jest.mock('react-native-reanimated', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        __esModule: true,
        default: { View: host('AnimatedView') },
        FadeOut: { duration: () => ({}) },
        LinearTransition: { duration: () => ({}) },
    };
});
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
jest.mock('@/constants/flags', () => ({ FOR_YOU_PEOPLE_V2: true }));
jest.mock('@/hooks/feed/useFollowCandidates', () => ({
    useFollowCandidates: () => ({
        data: [
            {
                user_id: 'short',
                display_name: 'Priya',
                avatar_url: null,
                kind: 'co_diner',
                meals_together: 3,
                logs_30d: null,
            },
            {
                user_id: 'long',
                display_name: 'Alexandria Montgomery-Smythe',
                avatar_url: null,
                kind: 'public',
                meals_together: null,
                logs_30d: 12,
            },
        ],
    }),
}));
jest.mock('@/hooks/feed/useCoDiners', () => ({ useCoDiners: () => ({ data: [] }) }));
jest.mock('@/hooks/users/useFollow', () => ({ useFollow: () => ({ mutate: jest.fn() }) }));
jest.mock('@/components/ui/napkin/PressableScale', () => ({
    PressableScale: (props: Record<string, unknown>) =>
        require('react').createElement('PressableScale', props, props.children),
}));
jest.mock('../SectionKicker', () => ({ SectionKicker: 'SectionKicker' }));

import { OnSocialsBlock } from '../OnSocialsBlock';
import { PeopleToFollowBlock } from '../PeopleToFollowBlock';
import { PublicListsBrowseBlock } from '../PublicListsBrowseBlock';

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map(flattenStyle));
    }
    return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

function hostsWithTestID(renderer: any, testID: string, type: string) {
    return renderer.root.findAllByProps({ testID }).filter((node: any) => node.type === type);
}

function social(id: string, name: string): SocialsCard {
    return {
        restaurant_id: id,
        name,
        neighborhood: null,
        rung: 1,
        window: 'week',
        count: 3,
        platform: 'tiktok',
        creator_handle: null,
        thumb_url: null,
        photo_url: null,
        photo_source: null,
        attribution_html: null,
    };
}

function list(id: string, title: string, cover: boolean): PublicListResult {
    return {
        id,
        owner_id: `owner-${id}`,
        title,
        description: null,
        ranked: false,
        emoji: null,
        entry_count: 4,
        updated_at: '2026-07-15T12:00:00.000Z',
        owner_display_name: 'Priya',
        owner_avatar_url: null,
        owner_username: 'priya',
        cover_photo_url: cover ? `https://images.test/${id}.jpg` : null,
        cover_restaurant_name: null,
        photo_source: cover ? 'places' : null,
        attribution_html: cover ? 'Jane Doe' : null,
    };
}

it('keeps short and long socials names on identical 136 × 166 cards', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <OnSocialsBlock cards={[
                social('short', 'Miznon'),
                social('long', 'Very Long Restaurant Name Here'),
            ]} />,
        );
    });

    const cards = hostsWithTestID(renderer, 'social-card', 'PressableScale');
    expect(cards).toHaveLength(2);
    for (const card of cards) {
        expect(flattenStyle(card.props.style)).toMatchObject({ width: 136, height: 166 });
    }

    const media = hostsWithTestID(renderer, 'social-media-frame', 'View');
    expect(media).toHaveLength(2);
    for (const frame of media) {
        expect(flattenStyle(frame.props.style)).toMatchObject({
            width: 136,
            height: 118,
            borderRadius: 14,
            shadowRadius: 30,
        });
    }

    const names = hostsWithTestID(renderer, 'social-name', 'Text');
    expect(names).toHaveLength(2);
    for (const name of names) {
        expect(name.props.numberOfLines).toBe(1);
        expect(flattenStyle(name.props.style)).toMatchObject({
            fontFamily: 'Newsreader_500Medium',
            fontSize: 15,
            height: 18,
        });
    }

    const signals = hostsWithTestID(renderer, 'social-signal', 'Text');
    expect(signals).toHaveLength(2);
    for (const signal of signals) {
        expect(signal.props.numberOfLines).toBe(1);
        expect(flattenStyle(signal.props.style)).toMatchObject({ fontSize: 13, height: 18 });
    }
    act(() => renderer.unmount());
});

it('keeps every people card compact and uniform with mock typography', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(<PeopleToFollowBlock />);
    });

    const cards = hostsWithTestID(renderer, 'person-card', 'View');
    expect(cards).toHaveLength(2);
    for (const card of cards) {
        expect(flattenStyle(card.props.style)).toMatchObject({
            width: 128,
            height: 172,
            borderRadius: 16,
        });
    }

    const names = hostsWithTestID(renderer, 'person-name', 'Text');
    expect(names).toHaveLength(2);
    for (const name of names) {
        expect(name.props.numberOfLines).toBe(1);
        expect(flattenStyle(name.props.style)).toMatchObject({
            fontFamily: 'Newsreader_500Medium',
            fontSize: 15,
            height: 18,
        });
    }

    const meta = hostsWithTestID(renderer, 'person-meta', 'Text');
    expect(meta).toHaveLength(2);
    for (const line of meta) {
        expect(flattenStyle(line.props.style)).toMatchObject({ fontSize: 13, height: 18 });
    }

    const follows = hostsWithTestID(renderer, 'person-follow', 'Pressable');
    expect(follows).toHaveLength(2);
    for (const follow of follows) {
        expect(flattenStyle(follow.props.style({ pressed: false }))).toMatchObject({
            borderWidth: 1.5,
            paddingHorizontal: 16,
            paddingVertical: 5,
        });
    }
    const followLabels = hostsWithTestID(renderer, 'person-follow-label', 'Text');
    expect(followLabels).toHaveLength(2);
    for (const label of followLabels) {
        expect(flattenStyle(label.props.style)).toMatchObject({
            fontFamily: 'Manrope_700Bold',
            fontSize: 13,
            fontWeight: '700',
        });
    }
    act(() => renderer.unmount());
});

it('matches the mock list plates and keeps list names upright', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <PublicListsBrowseBlock lists={[
                list('feature', 'Sunday lunch, solved', true),
                list('rail', 'Date nights that land', false),
            ]} />,
        );
    });

    const feature = hostsWithTestID(renderer, 'public-list-feature', 'PressableScale');
    expect(feature).toHaveLength(1);
    expect(flattenStyle(feature[0].props.style)).toMatchObject({
        height: 200,
        borderRadius: 18,
        marginHorizontal: 20,
    });

    const rail = hostsWithTestID(renderer, 'public-list-rail-card', 'PressableScale');
    expect(rail).toHaveLength(1);
    expect(flattenStyle(rail[0].props.style)).toMatchObject({
        width: 172,
        height: 165,
        borderRadius: 16,
    });

    const titles = hostsWithTestID(renderer, 'public-list-title', 'Text');
    expect(titles).toHaveLength(2);
    expect(titles.map((title: any) => flattenStyle(title.props.style).fontSize)).toEqual([21, 15]);
    for (const title of titles) {
        expect(flattenStyle(title.props.style).fontFamily).toBe('Newsreader_500Medium');
        expect(flattenStyle(title.props.style).fontFamily).not.toContain('Italic');
    }
    act(() => renderer.unmount());
});
