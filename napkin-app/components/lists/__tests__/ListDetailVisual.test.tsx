import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';
import { Colors } from '@/constants/theme';
import type { ListDetail, ListEntry, OwnerProfile } from '@/hooks/lists/useList';
import { ListDetailHeader, type ListDetailHeaderProps } from '../ListDetailHeader';
import { ListEntryRow } from '../ListEntryRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    StyleSheet: {
        absoluteFillObject: { position: 'absolute', inset: 0 },
        hairlineWidth: 0.5,
        create: (styles: unknown) => styles,
    },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
}));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/components/common', () => ({ SwipeToDeleteRow: 'SwipeToDeleteRow' }));
jest.mock('@/components/ui/napkin/PressableScale', () => ({ PressableScale: 'PressableScale' }));

function flattenStyle(style: unknown): Record<string, unknown> {
    const values = Array.isArray(style) ? style.flat(Infinity) : [style];
    return values.reduce<Record<string, unknown>>(
        (merged, value) => (value && typeof value === 'object' ? { ...merged, ...value } : merged),
        {},
    );
}

function entry(photoUrl: string | null): ListEntry {
    return {
        id: 'entry-1',
        list_id: 'list-1',
        restaurant_id: 'restaurant-1',
        note: null,
        position: 1024,
        created_at: '2026-07-15T00:00:00.000Z',
        restaurant: {
            id: 'restaurant-1',
            name: 'Kono at the very end of a deliberately long restaurant name',
            address: null,
            city: 'New York',
            country: 'US',
            photo_url: photoUrl,
            cuisine: 'Japanese',
            google_rating: null,
            price_level: 3,
            external_id: null,
            verification: 'verified',
            lat: 40.7,
            lng: -74,
        },
    };
}

function renderRow(photoUrl: string | null, isWishlisted = false) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <ListEntryRow
                entry={entry(photoUrl)}
                rank={3}
                isOwner
                isEditing={false}
                isRanked
                isWishlisted={isWishlisted}
                onPress={jest.fn()}
                onShowOnMap={jest.fn()}
                onRemove={jest.fn()}
                onNoteChange={jest.fn()}
                onToggleWishlist={jest.fn()}
            />,
        );
    });
    return renderer;
}

describe('ListEntryRow design AA', () => {
    it('renders a null-photo thumbnail as a plain warm tint with no image or glyph', () => {
        const renderer = renderRow(null);
        const thumbnail = renderer.root.findByProps({ testID: 'list-row-thumbnail' });

        expect(thumbnail.findAllByType('ExpoImage')).toHaveLength(0);
        expect(thumbnail.findAllByType('Ionicons')).toHaveLength(0);
        expect(flattenStyle(thumbnail.props.style)).toMatchObject({
            width: 54,
            height: 54,
            borderRadius: 12,
            backgroundColor: Colors.light.surfaceContainerHigh,
        });

        act(() => renderer.unmount());
    });

    it('uses the photo when present and keeps the dense 70pt base anatomy', () => {
        const renderer = renderRow('https://cdn.example/kono.jpg');
        const thumbnail = renderer.root.findByProps({ testID: 'list-row-thumbnail' });
        const row = renderer.root.findByProps({ testID: 'list-entry-row' });

        expect(thumbnail.findAllByType('ExpoImage')).toHaveLength(1);
        expect(flattenStyle(row.props.style)).toMatchObject({ paddingVertical: 8 });
        expect((flattenStyle(thumbnail.props.style).height as number) + 16).toBe(70);

        act(() => renderer.unmount());
    });

    it('pins the rank, name, metadata, and bare side-by-side actions to AA tokens', () => {
        const renderer = renderRow(null);
        const rank = renderer.root.findAllByType('Text').find((node: any) => node.children.includes('3'))!;
        const name = renderer.root.findByProps({ testID: 'list-row-name' });
        const meta = renderer.root.findByProps({ testID: 'list-row-meta' });
        const actions = renderer.root.findByProps({ testID: 'list-row-actions' });
        const locate = renderer.root.findByProps({
            accessibilityLabel: 'Show Kono at the very end of a deliberately long restaurant name on map',
        });
        const heart = renderer.root.findByProps({
            accessibilityLabel: 'Save Kono at the very end of a deliberately long restaurant name to Wishlist',
        });

        expect(flattenStyle(rank.props.style)).toMatchObject({
            fontFamily: 'Manrope_700Bold',
            fontSize: 12,
            color: Colors.light.terracottaWarm,
            fontVariant: ['tabular-nums'],
        });
        expect(flattenStyle(rank.parent?.props.style)).toMatchObject({
            width: 17,
            alignItems: 'flex-end',
        });
        expect(flattenStyle(name.props.style).fontFamily).toBe('Newsreader_400Regular');
        expect(flattenStyle(name.props.style).fontSize).toBe(16.5);
        expect(name.props.numberOfLines).toBe(1);
        expect(flattenStyle(meta.props.style)).toMatchObject({
            fontFamily: 'Manrope_500Medium',
            fontSize: 13,
            color: Colors.light.textSecondary,
        });
        expect(meta.children.join('')).toBe('Japanese · New York · $$$');

        expect(flattenStyle(actions.props.style)).toMatchObject({
            minHeight: 44,
            flexDirection: 'row',
            gap: 12,
        });
        expect(locate.props.hitSlop).toBe(6);
        expect(heart.props.hitSlop).toBe(6);
        expect(flattenStyle(locate.props.style)).toMatchObject({ width: 32, height: 32 });
        expect(flattenStyle(heart.props.style)).toMatchObject({ width: 32, height: 32 });
        expect(flattenStyle(locate.props.style).backgroundColor).toBeUndefined();
        expect(flattenStyle(heart.props.style).backgroundColor).toBeUndefined();
        expect(locate.findByType('Ionicons').props).toMatchObject({
            name: 'locate-outline',
            color: Colors.light.secondary,
        });
        expect(heart.findByType('Ionicons').props).toMatchObject({
            name: 'heart-outline',
            color: Colors.light.primary,
        });
        expect(heart.props.accessibilityState).toEqual({ selected: false, disabled: false });

        act(() => renderer.unmount());
    });

    it('fills the terracotta heart and exposes the pressed-equivalent saved state', () => {
        const renderer = renderRow(null, true);
        const heart = renderer.root.findByProps({
            accessibilityLabel: 'Remove Kono at the very end of a deliberately long restaurant name from Wishlist',
        });

        expect(heart.findByType('Ionicons').props).toMatchObject({
            name: 'heart',
            color: Colors.light.primary,
        });
        expect(heart.props.accessibilityState.selected).toBe(true);

        act(() => renderer.unmount());
    });
});

const ownerProfile: OwnerProfile = {
    display_name: 'Mara',
    username: 'mara',
    avatar_url: null,
    account_privacy: 'public',
};

function list(title: string): ListDetail {
    return {
        id: 'list-1',
        owner_id: 'owner-1',
        title,
        description: null,
        ranked: true,
        privacy: 'private',
        emoji: null,
        table_id: 'table-1',
        created_at: '2026-07-15T00:00:00.000Z',
        updated_at: '2026-07-15T00:00:00.000Z',
    };
}

function renderHeader(
    title: string,
    coverAttribution: string | null = null,
    cover: string | null = null,
) {
    const onAddSpots = jest.fn();
    const onShare = jest.fn();
    const props: ListDetailHeaderProps = {
        list: list(title),
        ownerProfile,
        cover,
        coverAttribution,
        metadata: '12 places',
        contextLine: { kind: 'table', text: 'Shared with everyone at this Table' },
        isOwner: true,
        canEditEntries: true,
        isEditingPlaces: false,
        isSaved: false,
        canSave: false,
        onToggleEditingPlaces: jest.fn(),
        onEditSettings: jest.fn(),
        onShare,
        onAddSpots,
    };
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(<ListDetailHeader {...props} />);
    });
    return { renderer, props, onAddSpots, onShare };
}

describe('ListDetailHeader design AA overlap guard', () => {
    it('renders the Places credit as a legible ghosted line outside the 44pt thumbnail', () => {
        const { renderer } = renderHeader(
            'Dinner ideas',
            'Jane Doe',
            'https://cdn.example/places.jpg',
        );
        const identity = renderer.root.findByProps({ testID: 'list-detail-header-identity' });
        const credit = renderer.root.findByProps({ testID: 'list-detail-cover-attribution' });

        expect(identity.findAllByProps({ testID: 'list-detail-cover-attribution' })).toHaveLength(1);
        expect(credit.children.join('')).toBe('Jane Doe');
        expect(credit.props.numberOfLines).toBe(1);
        expect(flattenStyle(credit.props.style)).toMatchObject({
            fontFamily: 'Manrope_500Medium',
            fontSize: 11,
            lineHeight: 14,
            opacity: 0.85,
            color: Colors.light.textMuted,
        });

        const image = renderer.root.findByType('ExpoImage');
        act(() => image.props.onError());
        expect(renderer.root.findAllByType('ExpoImage')).toHaveLength(0);
        expect(renderer.root.findAllByProps({ testID: 'list-detail-cover-attribution' })).toHaveLength(0);

        act(() => renderer.unmount());
    });

    it('ignores a late image error from a cover that was already replaced', () => {
        const { renderer, props } = renderHeader(
            'Dinner ideas',
            'Old credit',
            'https://cdn.example/old.jpg',
        );
        const failOldCover = renderer.root.findByType('ExpoImage').props.onError;

        act(() => {
            renderer.update(
                <ListDetailHeader
                    {...props}
                    cover="https://cdn.example/new.jpg"
                    coverAttribution="New credit"
                />,
            );
        });
        act(() => failOldCover());

        expect(renderer.root.findByType('ExpoImage').props.source).toEqual({
            uri: 'https://cdn.example/new.jpg',
        });
        expect(
            renderer.root.findByProps({ testID: 'list-detail-cover-attribution' }).children.join(''),
        ).toBe('New credit');

        act(() => renderer.unmount());
    });

    it.each([
        'Dinner ideas',
        'A deliberately long list title that must occupy two lines without reaching the caption action',
    ])('keeps the caption and add-spots action in a separate flow row for %s', (title) => {
        const { renderer, onAddSpots, onShare } = renderHeader(title);
        const identity = renderer.root.findByProps({ testID: 'list-detail-header-identity' });
        const captionRow = renderer.root.findByProps({ testID: 'list-detail-header-caption-row' });
        const titleNode = renderer.root.findByProps({ testID: 'list-detail-header-title' });
        const addButton = renderer.root.findByProps({ accessibilityLabel: 'Add spots' });
        const shareButton = renderer.root.findByProps({ accessibilityLabel: `Share ${title}` });

        expect(titleNode.props.numberOfLines).toBe(2);
        expect(identity.findAllByProps({ accessibilityLabel: 'Add spots' })).toHaveLength(0);
        expect(captionRow.findAllByProps({ accessibilityLabel: 'Add spots' })).toHaveLength(1);
        expect(flattenStyle(captionRow.props.style)).toMatchObject({
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
        });
        expect(flattenStyle(captionRow.props.style).position).toBeUndefined();
        expect(flattenStyle(addButton.props.style)).toMatchObject({ minHeight: 44 });
        expect(addButton.findByType('Text').children.join('')).toBe('+ add spots');
        expect(
            captionRow.findAllByType('Text').some(
                (node: any) => node.children.join('') === 'Shared with everyone at this Table',
            ),
        ).toBe(true);

        act(() => addButton.props.onPress());
        act(() => shareButton.props.onPress());
        expect(onAddSpots).toHaveBeenCalledTimes(1);
        expect(onShare).toHaveBeenCalledTimes(1);

        act(() => renderer.unmount());
    });
});
