/* eslint-disable import/first -- Register native mocks before imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, { accessible: name === 'Pressable', ...props }, props.children);
    return {
        Alert: { alert: jest.fn() },
        Linking: { openURL: jest.fn(() => Promise.resolve()) },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : style ?? {},
            absoluteFillObject: { position: 'absolute', inset: 0 },
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/components/restaurants/RestaurantPageV3', () => ({
    SectionHeading: ({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) => {
        const ReactModule = jest.requireActual('react');
        const { Pressable, Text, View } = jest.requireMock('react-native');
        return ReactModule.createElement(View, null,
            ReactModule.createElement(Text, null, label),
            action ? ReactModule.createElement(Pressable, { onPress: onAction, accessibilityRole: 'button', accessibilityLabel: action },
                ReactModule.createElement(Text, null, action)) : null,
        );
    },
}));

import React from 'react';
import { Alert, Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ClippingCard, type ClippingCardData } from '../ClippingCard';
import { OnSocialsRail } from '../OnSocialsRail';

const clip: ClippingCardData = {
    saver: { user_id: 'me', display_name: 'Jacky', avatar_url: null },
    relationship: 'self',
    source: { type: 'tiktok', url: 'https://www.tiktok.com/@food/video/123', author_handle: '@food' },
    thumb_url: null,
    also_count: 2,
    created_at: new Date().toISOString(),
};

describe('source notes', () => {
    it('is complete and opens the original when there is no thumbnail', async () => {
        const screen = render(<ClippingCard clip={clip} />);
        expect(screen.getByText('TikTok')).toBeTruthy();
        expect(screen.getByText('@food')).toBeTruthy();
        expect(screen.getByText(/clipped by you \+2/)).toBeTruthy();
        expect(screen.getByText('Open original')).toBeTruthy();
        expect(screen.queryByTestId('clipping-thumbnail')).toBeNull();
        fireEvent.press(screen.getByRole('link'));
        await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(clip.source.url));
    });

    it('keeps creator, attribution and action after thumbnail failure, then retries a replacement URL', () => {
        const screen = render(<ClippingCard clip={{ ...clip, thumb_url: 'https://storage.test/first.jpg' }} />);
        fireEvent(screen.getByTestId('clipping-thumbnail'), 'error');
        expect(screen.queryByTestId('clipping-thumbnail')).toBeNull();
        expect(screen.getByText('@food')).toBeTruthy();
        expect(screen.getByRole('link')).toBeTruthy();
        screen.rerender(<ClippingCard clip={{ ...clip, thumb_url: 'https://storage.test/replacement.jpg' }} />);
        expect(screen.getByTestId('clipping-thumbnail').props.source.uri).toBe('https://storage.test/replacement.jpg');
    });

    it('keeps a local video informational even if a stale source contains a URL or image', () => {
        const screen = render(<ClippingCard clip={{
            ...clip, source: { ...clip.source, type: 'video' }, thumb_url: 'https://storage.test/private.jpg',
        }} />);
        expect(screen.getByText('Imported video')).toBeTruthy();
        expect(screen.getByText('No original link')).toBeTruthy();
        expect(screen.queryByText('@food')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByTestId('clipping-thumbnail')).toBeNull();
        expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it.each([null, 'not a url', 'javascript:alert(1)'])('does not advertise an open action for %s', (url) => {
        const screen = render(<ClippingCard clip={{ ...clip, source: { ...clip.source, url } }} />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('Link unavailable')).toBeTruthy();
    });

    it('labels Instagram without inventing a creator', () => {
        const screen = render(<ClippingCard clip={{
            ...clip, source: { type: 'web', url: 'https://www.instagram.com/reel/abc/', author_handle: null },
        }} />);
        expect(screen.getByText('Instagram')).toBeTruthy();
        expect(screen.getByRole('link')).toBeTruthy();
    });

    it('reports a failed open without claiming the original was deleted', async () => {
        const silence = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('offline'));
        const screen = render(<ClippingCard clip={clip} />);
        fireEvent.press(screen.getByRole('link'));
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Couldn't open this clip", 'Try opening it again in a moment.'));
        silence.mockRestore();
    });

    it('hides an empty section and makes remaining sources available on demand', () => {
        const empty = render(<OnSocialsRail clippings={[]} />);
        expect(empty.toJSON()).toBeNull();
        empty.unmount();
        const clippings = Array.from({ length: 4 }, (_, index) => ({
            ...clip, source: { ...clip.source, author_handle: `food${index}` },
        }));
        const screen = render(<OnSocialsRail clippings={clippings} />);
        expect(screen.queryByText('@food3')).toBeNull();
        fireEvent.press(screen.getByRole('button', { name: 'all 4 clips ›' }));
        expect(screen.getByText('@food3')).toBeTruthy();
        fireEvent.press(screen.getByRole('button', { name: 'show less' }));
        expect(screen.queryByText('@food3')).toBeNull();
    });
});
