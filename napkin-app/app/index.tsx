import { Redirect } from 'expo-router';

export default function Index() {
    // Land on Wishlist (launch-readiness, 2026-07-03): a new account has zero
    // tables — the old '/tables' landing was a dead end — and the capture
    // surface is the first-value moment (journal-first positioning).
    return <Redirect href="/wishlist" />;
}
