import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

/** Legacy deep-link frame. Preserve both supported parameters verbatim. */
export default function SearchRedirect() {
    const { q, mode } = useLocalSearchParams<{ q?: string; mode?: string }>();
    return (
        <Redirect
            href={{
                pathname: '/(tabs)/places',
                params: {
                    ...(q !== undefined ? { q } : {}),
                    ...(mode !== undefined ? { mode } : {}),
                },
            }}
        />
    );
}
