/**
 * AppleSignInButton — Apple's own Sign in with Apple button (TICKET-246).
 *
 * WHY THIS REPLACED A CUSTOM PRESSABLE (App Store Guideline 4, 2026-09-14):
 * the old button drew an Ionicons "logo-apple" glyph — a redrawn, non-Apple logo,
 * which the HIG forbids outright ("Use only the logo artwork downloaded from
 * Apple Design Resources; never create a custom Apple logo") — and labelled it
 * with Type.label, which carries textTransform:'uppercase', so it rendered
 * "CONTINUE WITH APPLE". Apple permits exactly three strings: "Sign in with
 * Apple", "Sign up with Apple", "Continue with Apple". expo-apple-authentication
 * states the rule plainly: "The App Store Guidelines require you to use this
 * component to start the authentication process instead of a custom button."
 *
 * Apple allows ONE customisation: cornerRadius. Everything else — colours,
 * typeface, logo, label — is theirs. So this keeps the Heirloom pill geometry
 * (52pt tall, fully rounded) and surrenders the rest, which is why the label is
 * SF Pro here and Manrope on the Google button beside it. That asymmetry is
 * deliberate and must not be "fixed".
 *
 * LAZY require, matching lib/oauth.ts: a mis-linked native lib then fails at
 * RENDER with a caught error instead of crashing auth.tsx at module load.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

/** Matches styles.oauthBtn on the auth screen (minHeight 52) so Apple is never
 *  smaller than the Google button beside it — the HIG prominence rule. */
const BUTTON_HEIGHT = 52;
/** Half the height: Radius.full on a 52pt pill, expressed the one way Apple allows. */
const CORNER_RADIUS = BUTTON_HEIGHT / 2;

export function AppleSignInButton({
    onPress,
    disabled,
    style,
}: {
    onPress: () => void;
    disabled?: boolean;
    style?: object;
}) {
    let AppleAuthentication: typeof import('expo-apple-authentication');
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        AppleAuthentication = require('expo-apple-authentication');
    } catch {
        // Native module missing (Expo Go, a broken link). No affordance is better
        // than a dead one; email + Google still sign the user in.
        return null;
    }

    const Button = AppleAuthentication.AppleAuthenticationButton;
    if (!Button) return null;

    return (
        // The native button exposes no `disabled`, so the wrapper owns the
        // in-flight state: pointerEvents blocks the tap, opacity shows why.
        <View
            style={[styles.wrap, disabled ? styles.disabled : null, style]}
            pointerEvents={disabled ? 'none' : 'auto'}
        >
            <Button
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={CORNER_RADIUS}
                style={styles.button}
                onPress={onPress}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { width: '100%' },
    // Height and width are mandatory: "without these styles, the button will not
    // appear on the screen" (expo-apple-authentication).
    button: { width: '100%', height: BUTTON_HEIGHT },
    disabled: { opacity: 0.85 },
});
