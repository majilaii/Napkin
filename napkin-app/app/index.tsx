import { Redirect } from 'expo-router';

export default function Index() {
    // Redirect to explore tab by default
    // Auth redirection is handled in _layout.tsx
    return <Redirect href="/(tabs)/explore" />;
}
