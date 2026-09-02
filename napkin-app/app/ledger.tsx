import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';

import { LedgerScreen } from '@/components/ledger/LedgerScreen';
import { useAuth } from '@/providers/AuthProvider';

export default function LedgerRoute() {
    const { user } = useAuth();
    const { month, tableId } = useLocalSearchParams<{ month?: string; tableId?: string }>();
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <LedgerScreen viewerId={user?.id} initialMonth={month} tableId={tableId} />
        </>
    );
}
