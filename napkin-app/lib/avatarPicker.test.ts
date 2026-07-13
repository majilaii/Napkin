/* eslint-disable @typescript-eslint/no-require-imports */
let mockActionSheetCallback: ((index: number) => void) | undefined;
const mockAlert = jest.fn();
const mockRequestCameraPermission = jest.fn();

jest.mock('react-native', () => ({
    ActionSheetIOS: {
        showActionSheetWithOptions: jest.fn(
            (_options: unknown, callback: (index: number) => void) => {
                mockActionSheetCallback = callback;
            },
        ),
    },
    Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
    Platform: { OS: 'ios' },
}));

jest.mock('expo-image-picker', () => ({
    UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
    requestCameraPermissionsAsync: (...args: unknown[]) =>
        mockRequestCameraPermission(...args),
    launchCameraAsync: jest.fn(),
    launchImageLibraryAsync: jest.fn(),
}));

import { chooseAvatarAsset } from './avatarPicker';

describe('chooseAvatarAsset', () => {
    beforeEach(() => {
        mockActionSheetCallback = undefined;
        mockAlert.mockReset();
        mockRequestCameraPermission.mockReset();
    });

    it('settles and explains the fallback when the permission request rejects', async () => {
        const permissionError = new Error('native permission failure');
        mockRequestCameraPermission.mockRejectedValue(permissionError);
        const onSourceChosen = jest.fn();
        const selection = chooseAvatarAsset(onSourceChosen);

        expect(mockActionSheetCallback).toBeDefined();
        mockActionSheetCallback?.(0);

        await expect(selection).resolves.toBeNull();
        expect(onSourceChosen).toHaveBeenCalledTimes(1);
        expect(mockAlert).toHaveBeenCalledWith(
            "Couldn't access the camera",
            'Try choosing from your library.',
        );
    });
});
