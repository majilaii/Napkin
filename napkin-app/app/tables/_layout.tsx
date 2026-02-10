/**
 * Tables route layout
 */
import { Stack } from 'expo-router';
import React from 'react';

export default function TablesLayout() {
    return (
        <Stack>
            <Stack.Screen
                name="[id]"
                options={{
                    title: 'Table',
                    headerShown: true,
                    headerBackTitle: 'Tables',
                }}
            />
        </Stack>
    );
}
