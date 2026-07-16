import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockPatch = jest.fn();
const mockAlert = jest.fn();
const mockChooseAvatarAsset = jest.fn();
const mockStageAndModerate = jest.fn();
let mockDraft = {
    display_name: 'Jacky',
    avatar_url: null as string | null,
    home_city: null,
};

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        ActivityIndicator: host('ActivityIndicator'),
        Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        StyleSheet: {
            absoluteFillObject: {},
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
    };
});

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
    Stack: { Screen: () => null },
}));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'user-1' } }),
}));
jest.mock('@/components/feed/Avatar', () => ({
    Avatar: ({ name }: { name: string }) => {
        const { Text } = require('react-native');
        return require('react').createElement(Text, null, name);
    },
}));
jest.mock('@/lib/avatarPicker', () => ({
    chooseAvatarAsset: (...args: unknown[]) => mockChooseAvatarAsset(...args),
}));
jest.mock('@/lib/imageStaging', () => ({
    stageAndModerate: (...args: unknown[]) => mockStageAndModerate(...args),
    isModerationRejected: (error: { code?: string }) => error?.code === 'moderation_rejected',
}));
jest.mock('@/app/onboarding/OnboardingDraftContext', () => ({
    useOnboardingDraft: () => ({ draft: mockDraft, patch: mockPatch }),
}));

import OnboardingPhotoScreen from '@/app/onboarding/photo';

describe('mandatory onboarding photo', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDraft = { display_name: 'Jacky', avatar_url: null, home_city: null };
    });

    it('has no Skip affordance and blocks Continue before approval', () => {
        const screen = render(<OnboardingPhotoScreen />);

        expect(screen.queryByText('Skip')).toBeNull();
        const continueButton = screen.getByLabelText('Continue');
        expect(continueButton.props.accessibilityState).toEqual({ disabled: true });
        fireEvent.press(continueButton);
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('allows the next step only with an approved URL in the draft', () => {
        mockDraft = {
            display_name: 'Jacky',
            avatar_url: 'https://cdn.test/approved/avatar.jpg',
            home_city: null,
        };
        const screen = render(<OnboardingPhotoScreen />);

        fireEvent.press(screen.getByLabelText('Continue'));
        expect(mockPush).toHaveBeenCalledWith('/onboarding/city');
    });

    it('writes only the approved avatar returned by the staging saga', async () => {
        mockChooseAvatarAsset.mockImplementation(async (onChosen: () => void) => {
            onChosen();
            return { uri: 'file:///picked.jpg' };
        });
        mockStageAndModerate.mockResolvedValue({
            approved_url: 'https://cdn.test/approved/avatar.jpg',
            storage_path: 'approved/user-1/avatar.jpg',
            bucket: 'avatars',
            sha256: 'avatar-sha',
            verdict: 'pass',
        });
        const screen = render(<OnboardingPhotoScreen />);

        fireEvent.press(screen.getByText('Add a photo'));

        await waitFor(() => {
            expect(mockStageAndModerate).toHaveBeenCalledWith('file:///picked.jpg', 'avatar');
            expect(mockPatch).toHaveBeenCalledWith({
                avatar_url: 'https://cdn.test/approved/avatar.jpg',
            });
        });
    });

    it('shows a retry alert and never writes a rejected photo into the draft', async () => {
        mockChooseAvatarAsset.mockImplementation(async (onChosen: () => void) => {
            onChosen();
            return { uri: 'file:///rejected.jpg' };
        });
        mockStageAndModerate.mockRejectedValue({ code: 'moderation_rejected' });
        const screen = render(<OnboardingPhotoScreen />);

        fireEvent.press(screen.getByText('Add a photo'));

        await waitFor(() => {
            expect(mockAlert).toHaveBeenCalledWith("That photo can't be used", 'Choose another photo.');
        });
        expect(mockPatch).not.toHaveBeenCalled();
    });
});
