/**
 * Settings route tree layout — Stack so /settings/privacy and
 * /settings/privacy/make-public stack naturally with standard back-nav.
 */
import { Stack } from 'expo-router';
import React from 'react';

export default function SettingsLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }} />
    );
}
