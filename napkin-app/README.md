# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Local development

### iOS share extension — `RCT_NEW_ARCH_ENABLED` shell-env trap (TICKET-055)

**Problem:** If your shell exports `RCT_NEW_ARCH_ENABLED=0` globally (common
after following older Expo / Reanimated setup guides), `pod install` will fail
with a Reanimated podspec assertion:

```
[!] `RNReanimated` requires that the project enables New Architecture
```

This failure happens _even if_ `newArchEnabled: true` is set in `app.config.ts`,
because the environment variable overrides the config.

**Fix:** Always invoke prebuild and run commands with the env var set to `1`:

```bash
RCT_NEW_ARCH_ENABLED=1 npx expo prebuild --clean --platform ios
RCT_NEW_ARCH_ENABLED=1 npx expo run:ios
```

Or `unset RCT_NEW_ARCH_ENABLED` from your shell before running Expo commands.

The `app.config.ts` value (`newArchEnabled: true`) is the source of truth;
the shell env var takes precedence when set to `0`, which is the trap.

### iOS share extension — smoke test

After building with `RCT_NEW_ARCH_ENABLED=1 npx expo run:ios`:

1. Open Safari on the simulator, navigate to any URL.
2. Tap Share, scroll the share sheet, look for **"Napkin"**.
3. Tap "Napkin" — the main app foregrounds and `ImportLinkSheet` opens with the URL already resolving.
4. If "Napkin" does not appear in the share sheet, tap "More" to enable it.

Logged-out variant: sign out first, repeat from step 1. The app lands on `/auth`
with the copy "sign in to save links to your wishlist." After sign-in, the sheet
auto-opens with the original URL.

## Supabase + Google Places proxy

The Explore tab queries the Supabase Edge Function
`places-search`, which securely calls the Google Places API.

1. Set up `GOOGLE_PLACES_API_KEY` as a Supabase secret.
2. Run the function locally with `supabase functions serve places-search --env-file supabase/.env`.
3. Start Expo with `npm start` inside `napkin-app` and begin typing inside the Explore search field to hit the proxy.

Additional context for the Edge Function lives in `../supabase/README.md`.
