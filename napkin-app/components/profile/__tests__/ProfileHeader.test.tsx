/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';
import { ProfileHeader } from '../ProfileHeader';
import type { UserProfileRow } from '@/hooks/users/useUserProfile';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => {
        const Component = (props: Record<string, unknown>) =>
            ReactModule.createElement(name, props, props.children);
        Component.displayName = name;
        return Component;
    };

    return {
        ActivityIndicator: host('ActivityIndicator'),
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        Image: host('Image'),
        StyleSheet: {
            absoluteFillObject: {},
            create: (styles: unknown) => styles,
        },
        useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    };
});

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'user-1' } }),
}));
jest.mock('@/hooks/notifications', () => ({ useUnreadCount: () => 0 }));
jest.mock('@/components/notifications/NotifBell', () => ({ NotifBell: 'NotifBell' }));
jest.mock('../FollowButton', () => ({ FollowButton: 'FollowButton' }));
jest.mock('../CalibrationChip', () => ({ CalibrationChip: 'CalibrationChip' }));
jest.mock('../RateMoreToUnlockPrompt', () => ({
    RateMoreToUnlockPrompt: 'RateMoreToUnlockPrompt',
}));
jest.mock('../ProfileImportsAffordance', () => ({
    ProfileImportsAffordance: (props: Record<string, unknown>) =>
        require('react').createElement('ProfileImportsAffordance', props),
}));
jest.mock('@/components/ui/napkin', () => ({
    PressableScale: (props: Record<string, unknown>) =>
        require('react').createElement('PressableScale', props, props.children),
}));

function profile(avatarUrl: string | null): UserProfileRow {
    return {
        user_id: 'user-1',
        username: 'clara',
        display_name: 'Clara Example',
        bio: null,
        avatar_url: avatarUrl,
        account_privacy: 'public',
        allow_public_replies: true,
    };
}

function renderHeader(overrides: Partial<React.ComponentProps<typeof ProfileHeader>> = {}) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <ProfileHeader
                profile={profile(null)}
                isSelf
                relationship="self"
                onAddPhoto={jest.fn()}
                {...overrides}
            />,
        );
    });
    return renderer;
}

function cameraButton(renderer: ReturnType<typeof renderHeader>) {
    return renderer.root.findAll(
        // Component + host can both carry props; select the host node.
        (node: any) =>
            node.type === 'PressableScale' && node.props.testID === 'profile-add-photo',
    );
}

describe('ProfileHeader add-photo affordance', () => {
    it('shows the labeled camera action for the owner with no photo', () => {
        const onAddPhoto = jest.fn();
        const renderer = renderHeader({ onAddPhoto });

        const buttons = cameraButton(renderer);
        expect(buttons).toHaveLength(1);
        expect(buttons[0].props.accessibilityLabel).toBe('Add a profile photo');
        expect(buttons[0].props.accessibilityRole).toBe('button');

        act(() => buttons[0].props.onPress());
        expect(onAddPhoto).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });

    it('does not show the shortcut for an existing photo or someone else', () => {
        const withPhoto = renderHeader({
            profile: profile('https://cdn.example/avatar.jpg'),
        });
        const otherPerson = renderHeader({ isSelf: false, relationship: 'public_only' });

        expect(cameraButton(withPhoto)).toHaveLength(0);
        expect(cameraButton(otherPerson)).toHaveLength(0);
        act(() => withPhoto.unmount());
        act(() => otherPerson.unmount());
    });

    it('disables the action and replaces the camera with a spinner while saving', () => {
        const renderer = renderHeader({ isAddingPhoto: true });
        const button = cameraButton(renderer)[0];

        expect(button.props.disabled).toBe(true);
        expect(button.props.accessibilityState).toEqual({ busy: true, disabled: true });
        expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(1);
        act(() => renderer.unmount());
    });
});

// TICKET-191 rev 2: the imports tray lives in the SELF actions row only —
// a stranger's header (follow + safety row) never carries it.
describe('ProfileHeader imports affordance gate', () => {
    it('renders the tray in the self actions row and passes the slot through', () => {
        const slot = { kind: 'failed', accent: 'attention' };
         
        const renderer = renderHeader({ importSlot: slot as any });
        const nodes = renderer.root.findAllByType('ProfileImportsAffordance');
        expect(nodes).toHaveLength(1);
        expect(nodes[0].props.slot).toBe(slot);
        act(() => renderer.unmount());
    });

    it('renders no tray for a stranger', () => {
        const renderer = renderHeader({ isSelf: false, relationship: 'public_only' });
        expect(renderer.root.findAllByType('ProfileImportsAffordance')).toHaveLength(0);
        act(() => renderer.unmount());
    });
});
