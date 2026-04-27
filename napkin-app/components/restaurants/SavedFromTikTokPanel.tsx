/**
 * SavedFromTikTokPanel — shows the TikTok thumbnail + attribution for a wishlist
 * entry that was saved via a TikTok video (TICKET-054).
 *
 * Design rules (Heirloom Journal):
 * - 9:16 portrait thumbnail at ~38% panel width, left-aligned
 * - Attribution column right of thumbnail: italic Newsreader "saved from tiktok"
 *   + Manrope "@handle"
 * - Single Pressable wrapping both; tap → Linking.openURL
 * - onError → warm-paper placeholder (same 9:16 frame, no broken-image icon)
 * - No TikTok logo, no emoji, no hard 1px border
 * - Ambient shadow on thumbnail only
 */
import React, { useState } from 'react';
import {
    Alert,
    Linking,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { WishlistSourceTikTok } from '@/lib/types/wishlistSource';

interface SavedFromTikTokPanelProps {
    source: WishlistSourceTikTok;
}

export function SavedFromTikTokPanel({ source }: SavedFromTikTokPanelProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const [thumbnailFailed, setThumbnailFailed] = useState(false);

    // Attribution: prefer author_handle, fallback to author_name
    const handle = source.author_handle ?? source.author_name ?? null;

    const handlePress = async () => {
        if (!source.url) return; // defensive — shouldn't happen post-TICKET-053
        try {
            await Linking.openURL(source.url);
        } catch (err) {
            console.error('[SavedFromTikTokPanel] Linking.openURL failed', err);
            Alert.alert("Couldn't open this link", 'Try again later.');
        }
    };

    const hasUrl = !!source.url;

    const inner = (
        <View style={styles.inner}>
            {/* Thumbnail — 9:16 portrait */}
            <View
                style={[
                    styles.thumbnailContainer,
                    {
                        backgroundColor: palette.surfaceContainerHigh,
                        ...Shadow.subtle,
                    },
                ]}
            >
                {!thumbnailFailed && source.thumbnail_url ? (
                    <ExpoImage
                        source={{ uri: source.thumbnail_url }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        onError={() => setThumbnailFailed(true)}
                    />
                ) : null}
                {/* Warm-paper inset hairline overlay — Heirloom rule: no hard 1px border */}
                <View
                    style={[
                        StyleSheet.absoluteFill,
                        styles.borderOverlay,
                        { backgroundColor: palette.surfaceJournalLow },
                    ]}
                    pointerEvents="none"
                />
            </View>

            {/* Attribution column */}
            <View style={styles.attribution}>
                <Text style={[Type.headlineItalic, styles.savedFromText, { color: palette.text }]}>
                    saved from tiktok
                </Text>
                {handle ? (
                    <Text
                        style={[Type.body, styles.handleText, { color: palette.textMuted }]}
                        numberOfLines={1}
                    >
                        @{handle}
                    </Text>
                ) : null}
            </View>
        </View>
    );

    if (!hasUrl) {
        // No URL — render non-interactive
        return (
            <View
                style={[
                    styles.container,
                    { backgroundColor: palette.surfaceJournalLow },
                ]}
                accessible
                accessibilityLabel={
                    handle
                        ? `saved from tiktok by @${handle}`
                        : 'saved from tiktok'
                }
            >
                {inner}
            </View>
        );
    }

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole="link"
            accessibilityLabel={
                handle
                    ? `saved from tiktok by @${handle}, opens on tiktok`
                    : 'saved from tiktok, opens on tiktok'
            }
            style={({ pressed }) => [
                styles.container,
                { backgroundColor: palette.surfaceJournalLow, opacity: pressed ? 0.88 : 1 },
            ]}
        >
            {inner}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        marginHorizontal: 22,
        marginVertical: Spacing.md,
        borderRadius: Radius.md,
        overflow: 'hidden',
        minHeight: 48,
    },
    inner: {
        flexDirection: 'row',
        padding: Spacing.sm,
        alignItems: 'center',
        gap: Spacing.md,
    },
    thumbnailContainer: {
        // ~38% of panel width — flex: 0.38 relative to attribution flex: 1 gives ≈ 27%,
        // so we use a fixed flex basis approach: flex: 2 thumbnail vs flex: 3 attribution
        // gives 40% / 60% split which matches the 38–40% spec.
        flex: 2,
        aspectRatio: 9 / 16,
        borderRadius: Radius.md,
        overflow: 'hidden',
    },
    borderOverlay: {
        opacity: 0.08,
        borderRadius: Radius.md,
    },
    attribution: {
        flex: 3,
        justifyContent: 'center',
        gap: Spacing.xs,
    },
    savedFromText: {
        fontSize: 15,
        lineHeight: 20,
    },
    handleText: {
        fontSize: 13,
    },
});
