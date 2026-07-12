/**
 * /settings/import-tutorial — replayable import education for existing users.
 *
 * This intentionally renders the teaching component directly instead of routing
 * through /onboarding/teach. Replaying never changes profiles.onboarded_at and the
 * terminal action simply returns to Settings.
 */
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TeachShareSheetDemo } from '@/components/import-education';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function ImportTutorialReplayScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const close = () => router.back();

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
            <TeachShareSheetDemo
                palette={palette}
                topInset={insets.top}
                bottomInset={insets.bottom}
                onClose={close}
                onDone={close}
                doneLabel="Done"
            />
        </View>
    );
}
