/**
 * Settings route tree layout — Stack so /settings/privacy and
 * /settings/privacy/make-public stack naturally with standard back-nav.
 */
import { Stack } from 'expo-router';
import React from 'react';

import { Colors } from '@/constants/theme';

export default function SettingsLayout() {
    return (
        // contentStyle: nested navigators don't inherit the root Stack's warm
        // paper card — set it here too so pushes never flash white.
        <Stack
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: Colors.light.background },
            }}
        />
    );
}
