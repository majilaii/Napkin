/**
 * SavedFromTikTokPanel — quiet provenance line for a wishlist spot, showing WHERE
 * you saved it from (TICKET-054; generalized TICKET-083 polish).
 *
 * Now handles every import source, not just TikTok:
 *   • tiktok → "saved from tiktok · @handle"  → taps out to the video
 *   • web + instagram URL → "saved from instagram" → taps out to the reel/post
 *   • web    → "saved from a link"            → taps out to the link
 *   • video  → "saved from a video"           → no link (you shared the file)
 *
 * Heirloom: lowercase verb, middle-dot separator, Ionicons outline, muted Manrope,
 * no card / shadow / thumbnail. Lives with the restaurant metadata row.
 */
import React from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { WishlistSource } from '@/lib/types/wishlistSource';
import { isInstagramSource } from '@/components/wishlist/importSourceLabel';

interface SavedFromSourcePanelProps {
    source: WishlistSource;
}

type Glyph = React.ComponentProps<typeof Ionicons>['name'];

function describe(source: WishlistSource): { glyph: Glyph; label: string; url: string | null } | null {
    switch (source.type) {
        case 'tiktok': {
            const handle = source.author_handle ?? source.author_name ?? null;
            return {
                glyph: 'logo-tiktok',
                label: `saved from tiktok${handle ? ` · @${handle}` : ''}`,
                url: source.url ?? null,
            };
        }
        case 'web':
            // Instagram rides type 'web' (no first-class variant in the source
            // CHECK) — detect from the URL so reels read as instagram.
            if (isInstagramSource(source)) {
                return { glyph: 'logo-instagram', label: 'saved from instagram', url: source.url ?? null };
            }
            return { glyph: 'link-outline', label: 'saved from a link', url: source.url ?? null };
        case 'video':
            return { glyph: 'videocam-outline', label: 'saved from a video', url: null };
        default:
            return null;
    }
}

export function SavedFromTikTokPanel({ source }: SavedFromSourcePanelProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const d = describe(source);
    if (!d) return null;

    const line = (
        <View style={styles.row}>
            <Ionicons name={d.glyph} size={14} color={palette.textMuted} style={styles.glyph} />
            <Text style={[styles.label, { color: palette.textMuted }]} numberOfLines={1}>
                {d.label}
            </Text>
        </View>
    );

    if (!d.url) {
        return (
            <View style={styles.wrap} accessible accessibilityLabel={d.label}>
                {line}
            </View>
        );
    }

    const handlePress = async () => {
        try {
            await Linking.openURL(d.url as string);
        } catch (err) {
            console.error('[SavedFromTikTokPanel] Linking.openURL failed', err);
            Alert.alert("Couldn't open this link", 'Try again later.');
        }
    };

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole="link"
            accessibilityLabel={`${d.label}, opens the source`}
            style={({ pressed }) => [styles.wrap, { opacity: pressed ? 0.6 : 1 }]}
            hitSlop={8}
        >
            {line}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: {
        marginHorizontal: 22,
        marginTop: Spacing.xs,
        marginBottom: Spacing.sm,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    glyph: {
        marginTop: 1,
    },
    label: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        flexShrink: 1,
    },
});
