import type { ExpoConfig, ConfigContext } from 'expo/config';
import { withEntitlementsPlist, type ConfigPlugin } from 'expo/config-plugins';

// TICKET-120: notifications are device-LOCAL only — no APNs, ever (remote push is
// explicitly deferred). expo-notifications' plugin unconditionally adds the
// aps-environment (remote push) entitlement, which our provisioning profiles don't
// carry — the first TICKET-120 TestFlight build died on exactly that mismatch.
// Local notifications need NO entitlement, so strip it at prebuild.
//
// Ordering note: entitlements mods execute in REVERSE registration order (each
// wrapper runs its action, then delegates to the previously registered chain — see
// @expo/config-plugins withMod). Wrapping the exported config registers this mod
// BEFORE the plugins array compiles, so it runs LAST and wins over
// expo-notifications. Delete this when remote push actually ships.
const withLocalOnlyNotifications: ConfigPlugin = (config) =>
    withEntitlementsPlist(config, (c) => {
        delete c.modResults['aps-environment'];
        return c;
    });

export default ({ config }: ConfigContext): ExpoConfig =>
    withLocalOnlyNotifications({
    ...config,
    // ARCH-REVIEW-1: Keep name as 'dining-journal-app' (Expo project identity /
    // EAS dashboard / slug-derived identifiers). CFBundleDisplayName is set
    // explicitly on the main app via ios.infoPlist and on the share extension
    // via its custom Info.plist.
    name: 'dining-journal-app',
    slug: 'dining-journal-app',
    owner: 'majilaii',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    // ARCH-REVIEW-3: Both schemes declared so Expo iOS plugin writes both into
    // CFBundleURLTypes. 'napkin' is the primary emit-path; 'diningjournalapp'
    // is kept as an inbound-parse alias for pre-existing copied links.
    scheme: ['napkin', 'diningjournalapp'],
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
        // App Store v1 ships iPhone-only: the layout has never been tested on
        // iPad, and iPhone-only avoids the 13" iPad screenshot set + an extra
        // review surface. iPads still run it in compatibility mode.
        supportsTablet: false,
        bundleIdentifier: 'com.majilaii.dining-journal-app',
        // TICKET-110: emits the com.apple.developer.applesignin entitlement so
        // expo-apple-authentication's native sheet works. The EAS build with
        // APPLE_TEAM_ID set manages the provisioning-profile capability.
        usesAppleSignIn: true,
        // ARCH-REVIEW-1: Set CFBundleDisplayName explicitly on main app so
        // the home-screen icon label reads "Napkin" (not "dining-journal-app").
        infoPlist: {
            CFBundleDisplayName: 'Napkin',
            // HTTPS-only networking = exempt; without this every TestFlight
            // upload stalls on the Missing Compliance questionnaire.
            ITSAppUsesNonExemptEncryption: false,
            // Foreground-only location: bias Places search + sort saved spots by
            // distance ("near me"). Requested lazily, never background.
            NSLocationWhenInUseUsageDescription:
                'Napkin uses your location to sort your saved spots by distance and find places near you.',
            // TICKET-082: on-device voiceover transcription when importing a video
            // (the spoken restaurant names). Runs on-device; audio is not uploaded.
            NSSpeechRecognitionUsageDescription:
                'Napkin reads the names spoken in a video you import so it can find those restaurants. This runs on your device.',
            // ARCH-REVIEW-3: Belt-and-suspenders in case Expo SDK 54 string-array
            // scheme doesn't emit both entries. Explicit declaration guarantees both.
            CFBundleURLTypes: [
                {
                    CFBundleURLSchemes: ['napkin', 'diningjournalapp'],
                },
            ],
        },
        // App-group entitlement declared now (v1 doesn't read it) so v1.5
        // shared-keychain path doesn't require another native rebuild.
        entitlements: {
            'com.apple.security.application-groups': ['group.com.majilaii.napkin.shared'],
        },
        // Read from env var; unset = plugin warns but prebuild still works for sim.
        ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
        // TICKET-131: key-gated Google-on-iOS map tiles. The entry exists ONLY
        // when GOOGLE_MAPS_IOS_KEY is set at build time — an empty/undefined
        // config.googleMapsApiKey would still trigger the Google Maps pods at
        // prebuild. Keyless builds stay Apple Maps (PROVIDER_DEFAULT + vellum
        // wash); WishlistMapView reads Constants.expoConfig.ios.config to flip
        // to PROVIDER_GOOGLE + heirloomMapStyle at runtime.
        ...(process.env.GOOGLE_MAPS_IOS_KEY
            ? { config: { googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY } }
            : {}),
    },
    android: {
        adaptiveIcon: {
            backgroundColor: '#E6F4FE',
            foregroundImage: './assets/images/android-icon-foreground.png',
            backgroundImage: './assets/images/android-icon-background.png',
            monochromeImage: './assets/images/android-icon-monochrome.png',
        },
        edgeToEdgeEnabled: true,
        predictiveBackGestureEnabled: false,
        config: {
            googleMaps: {
                apiKey: '',
            },
        },
        permissions: [
            // Foreground-only location for Places bias + "near me" wishlist sort.
            // RECORD_AUDIO dropped (TICKET-090): photos-only picker, no mic use.
            'android.permission.ACCESS_COARSE_LOCATION',
            'android.permission.ACCESS_FINE_LOCATION',
        ],
    },
    web: {
        output: 'static',
        favicon: './assets/images/favicon.png',
    },
    plugins: [
        'expo-router',
        // TICKET-110: GoogleSignIn v16 pulls in AppCheckCore, whose deps
        // (GoogleUtilities, RecaptchaInterop) can't integrate as static
        // libraries without module maps. Static frameworks give them modules.
        [
            'expo-build-properties',
            {
                ios: { useFrameworks: 'static' },
            },
        ],
        [
            'expo-image-picker',
            {
                photosPermission:
                    '$(PRODUCT_NAME) would like to access your photo library to add a photo to your entry.',
                cameraPermission:
                    '$(PRODUCT_NAME) would like to use your camera to take a photo for your entry.',
                // TICKET-090: photos only (mediaTypes: ['images'] everywhere) — no
                // mic string, or App Review asks why a food journal wants audio.
                microphonePermission: false,
            },
        ],
        [
            'expo-location',
            {
                // Foreground-only. The plugin's default Always strings read as
                // background tracking to App Review — explicitly disabled.
                locationWhenInUsePermission:
                    'Napkin uses your location to sort your saved spots by distance and find places near you.',
                locationAlwaysPermission: false,
                locationAlwaysAndWhenInUsePermission: false,
                isIosBackgroundLocationEnabled: false,
            },
        ],
        [
            'expo-splash-screen',
            {
                image: './assets/images/splash-icon.png',
                imageWidth: 200,
                resizeMode: 'contain',
                backgroundColor: '#ffffff',
                dark: {
                    backgroundColor: '#000000',
                },
            },
        ],
        'expo-web-browser',
        // TICKET-120: device-LOCAL import-completion notifications (no APNs/remote
        // push, no token). Defaults — no custom notification icon/sound/color.
        'expo-notifications',
        // TICKET-075: native month-calendar date picker for the logger WHEN row.
        '@react-native-community/datetimepicker',
        // @bacons/apple-targets auto-discovers targets/ dirs containing
        // expo-target.config.js. No inline config needed.
        '@bacons/apple-targets',
        // TICKET-110: native Sign in with Apple.
        'expo-apple-authentication',
        // TICKET-110: Google sign-in. iosUrlScheme is the REVERSED iOS OAuth
        // client id (from Google Cloud console); env-driven so the real value
        // isn't committed. The placeholder lets prebuild/EAS build succeed —
        // Google sign-in silently no-ops until the founder sets the env + wires
        // the Supabase dashboard (see ticket SHIP GATE). Coexists with the
        // napkin:// scheme in CFBundleURLTypes.
        [
            '@react-native-google-signin/google-signin',
            {
                iosUrlScheme:
                    process.env.GOOGLE_IOS_URL_SCHEME ??
                    'com.googleusercontent.apps.REPLACE_ME',
            },
        ],
        // TICKET-121: crash reporting. org/project/url identify where source
        // maps upload (EU data region → de.sentry.io). Auth is via the
        // SENTRY_AUTH_TOKEN build env (secret, never committed); production
        // enables upload by dropping SENTRY_DISABLE_AUTO_UPLOAD in eas.json.
        [
            '@sentry/react-native/expo',
            {
                organization: 'napkin-h7',
                project: 'react-native',
                url: 'https://de.sentry.io/',
            },
        ],
    ],
    experiments: {
        typedRoutes: true,
        reactCompiler: true,
    },
    extra: {
        eas: {
            projectId: '21d56495-18b4-46c9-9a81-673649cc1dca',
        },
        // TICKET-131 cold-review P1 fix: the runtime manifest STRIPS ios.config,
        // so WishlistMapView can never read the key from there. Mirror the key's
        // PRESENCE (never the key itself) into extra, which survives into
        // Constants.expoConfig. Same env var gates the native pods at prebuild,
        // so flag ⇔ native Google support by construction.
        hasGoogleMapsIosKey: !!process.env.GOOGLE_MAPS_IOS_KEY,
    },
});
