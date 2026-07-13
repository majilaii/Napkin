/**
 * avatarPicker — the standard "Take photo / Choose from library / Cancel"
 * source sheet for profile photos.
 *
 * LATENCY DOCTRINE — why library picks must NEVER pass allowsEditing:
 * expo-image-picker routes `allowsEditing: true` library picks to the LEGACY
 * UIImagePickerController (ios/ImagePickerModule.swift launchImagePicker —
 * only `!allowsEditing && sourceType != .camera` gets the modern PHPicker).
 * The legacy picker takes 1–2s to present; PHPicker is near-instant — this
 * was the whole "other apps are instant, ours isn't" gap. Apple's crop screen
 * is redundant anyway: compressAndUploadAvatar center-crops to 512² itself.
 * `preferredAssetRepresentationMode: 'current'` skips post-selection
 * transcoding (we re-encode ourselves). The camera path always uses the
 * legacy controller regardless, so it keeps allowsEditing — Move-and-Scale
 * after capture is the standard avatar framing step.
 *
 * The action sheet gives instant tap feedback; library picks need no
 * permission (out-of-process system picker, SDK 54); the camera does.
 */
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

const LIBRARY_OPTS: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // NO allowsEditing — it silently swaps in the slow legacy picker (above).
    preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    quality: 0.85, // recompressed to 512² @0.8 on upload — no need for max here
};

const CAMERA_OPTS: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
};

async function fromLibrary(): Promise<ImagePicker.ImagePickerAsset | null> {
    let picked: ImagePicker.ImagePickerResult;
    try {
        picked = await ImagePicker.launchImageLibraryAsync(LIBRARY_OPTS);
    } catch {
        Alert.alert("Couldn't open your library", 'Please try again.');
        return null;
    }
    if (picked.canceled || !picked.assets?.length) return null;
    return picked.assets[0];
}

async function fromCamera(): Promise<ImagePicker.ImagePickerAsset | null> {
    let status: ImagePicker.PermissionStatus;
    try {
        ({ status } = await ImagePicker.requestCameraPermissionsAsync());
    } catch {
        Alert.alert("Couldn't access the camera", 'Try choosing from your library.');
        return null;
    }
    if (status !== 'granted') {
        Alert.alert('Camera access needed', 'Enable camera access in Settings.');
        return null;
    }
    let picked: ImagePicker.ImagePickerResult;
    try {
        picked = await ImagePicker.launchCameraAsync(CAMERA_OPTS);
    } catch {
        Alert.alert("Couldn't open the camera", 'Try choosing from your library.');
        return null;
    }
    if (picked.canceled || !picked.assets?.length) return null;
    return picked.assets[0];
}

/**
 * Instant source sheet → system picker. Resolves with the picked square asset,
 * or null (canceled / denied / failed — user-facing alerts already shown).
 *
 * `onSourceChosen` fires the moment the user commits to a source — before the
 * (slow) system picker presents — so callers can raise a busy state that covers
 * the presentation gap. Callers must clear it when the promise resolves null.
 */
export function chooseAvatarAsset(
    onSourceChosen?: () => void,
): Promise<ImagePicker.ImagePickerAsset | null> {
    return new Promise((resolve) => {
        const go = (source: () => Promise<ImagePicker.ImagePickerAsset | null>) => {
            onSourceChosen?.();
            // Every source settles the outer promise, even if a native picker
            // rejects somewhere outside its normal guarded path.
            void source().then(resolve, () => resolve(null));
        };
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: ['Take photo', 'Choose from library', 'Cancel'],
                    cancelButtonIndex: 2,
                },
                (index) => {
                    if (index === 0) go(fromCamera);
                    else if (index === 1) go(fromLibrary);
                    else resolve(null);
                },
            );
        } else {
            // Android ships later — Alert stands in for the sheet. cancelable +
            // onDismiss so an outside tap still resolves (never a hung promise).
            Alert.alert(
                'Profile photo',
                undefined,
                [
                    { text: 'Take photo', onPress: () => go(fromCamera) },
                    { text: 'Choose from library', onPress: () => go(fromLibrary) },
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
                ],
                { cancelable: true, onDismiss: () => resolve(null) },
            );
        }
    });
}
