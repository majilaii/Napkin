import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { LedgerScreen } from '@/components/ledger/LedgerScreen';
import { useAuth } from '@/providers/AuthProvider';

export default function LedgerRoute() {
    const { user } = useAuth();
    const { month, tableId } = useLocalSearchParams<{ month?: string; tableId?: string }>();
    return <LedgerScreen viewerId={user?.id} initialMonth={month} tableId={tableId} />;
}
