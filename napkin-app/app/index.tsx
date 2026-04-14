import { Redirect } from 'expo-router';

export default function Index() {
    // Group segments are transparent in expo-router URLs — `/tables` resolves
    // to app/(tabs)/tables.tsx. This is more reliable than `/(tabs)/tables`.
    return <Redirect href="/tables" />;
}
