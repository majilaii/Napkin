/**
 * ImportSourceCard — the review-screen header that answers "where did this come
 * from?" BEFORE you approve the extracted spots (TICKET-180). A cover thumbnail +
 * platform logo · "from TikTok" · creator @handle, and a quiet "watch again ↗" that
 * deep-links back into the original clip.
 *
 * Heirloom: warm-paper card, ambient shadow, the thumbnail gets the standard clip
 * treatment (Radius.md + a hairline outline). Functional text (label / handle /
 * link) is Manrope — never italic serif. Copy economy: logo · handle · watch again,
 * no sentences.
 *
 * The provider thumbnail URL rots in hours–days (review is usually same-day); on
 * load failure it degrades to a platform-logo plate at the IDENTICAL footprint —
 * never a broken-image box, never a reflow (the ClippingCard `imgFailed` pattern).
 * The durable clip_thumbs copy (TICKET-156, server-keyed) is deliberately NOT
 * re-derived here; the manifest-persisted provider URL is the v1 source.
 */
import React, { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    importSourceIcon,
    importSourceLabel,
    isWatchableClip,
    manifestDisplaySource,
    type ManifestDisplaySource,
} from './importSourceLabel';

const THUMB_W = 62;
const THUMB_H = Math.round((THUMB_W * 4) / 3); // 3:4 portrait — clips are vertical

/** The manifest fields these surfaces read (kept loose so any caller shape fits). */
export interface ImportSourceManifestLike {
    kind: 'video' | 'url';
    url?: string;
    sourceThumbUrl?: string | null;
    sourceHandle?: string | null;
}

/**
 * "watch again ↗" — the escape hatch back to the ORIGINAL clip. Shared by the
 * review card and both hub row states. Renders nothing unless the source is a
 * re-watchable clip (tiktok / IG) with a url. Opens the url with the ClippingCard
 * Linking pattern verbatim — no pre-flight liveness check, a dead/private video
 * shows a non-crashing Alert. This is an EXTERNAL Linking call (deep-links into the
 * TikTok/IG app), never in-app nav — hierarchical back-nav is untouched.
 */
export function WatchAgainLink({ source }: { source: ManifestDisplaySource }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    if (!isWatchableClip(source) || !source.url) return null;
    const url = source.url;

    const handlePress = async () => {
        try {
            await Linking.openURL(url);
        } catch (err) {
            console.error('[WatchAgainLink] Linking.openURL failed', err);
            Alert.alert("Couldn't open this clip", 'The video may have been removed. Try again later.');
        }
    };

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole="link"
            accessibilityLabel="watch again, opens the original clip"
            hitSlop={8}
            style={({ pressed }) => [styles.watchRow, { opacity: pressed ? 0.6 : 1 }]}
        >
            <Text style={[styles.watchText, { color: palette.primary }]}>watch again ↗</Text>
        </Pressable>
    );
}

/**
 * Review-header source card. `manifest` supplies kind/url/thumb/handle; everything
 * displayed is derived from the shared manifestDisplaySource mapping so the card
 * and the hub rows always agree on the source identity.
 */
export function ImportSourceCard({ manifest }: { manifest: ImportSourceManifestLike }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [imgFailed, setImgFailed] = useState(false);

    const source = manifestDisplaySource(manifest);
    const glyph = importSourceIcon(source);
    const label = importSourceLabel(source);
    const handle = manifest.sourceHandle ?? null;
    const thumbUrl = manifest.sourceThumbUrl ?? null;
    const showPhoto = !!thumbUrl && !imgFailed;

    const a11yLabel = [label, handle ? `@${handle}` : null].filter(Boolean).join(', ');

    return (
        <View
            style={[styles.card, { backgroundColor: palette.card }, Shadow.ambient]}
            accessible
            accessibilityLabel={a11yLabel}
        >
            {/* Cover thumbnail — clip treatment (radius + hairline), or a logo plate
                at the identical footprint when absent/rotted (never a broken box). */}
            <View
                style={[
                    styles.thumb,
                    { backgroundColor: palette.surfaceJournalLow, borderColor: palette.outlineVariant },
                ]}
            >
                {showPhoto ? (
                    <ExpoImage
                        source={{ uri: thumbUrl as string }}
                        style={styles.thumbImg}
                        contentFit="cover"
                        recyclingKey={thumbUrl}
                        transition={120}
                        onError={() => setImgFailed(true)}
                    />
                ) : (
                    <Ionicons name={glyph} size={24} color={palette.textMuted} />
                )}
            </View>

            {/* Identity column — logo · label, @handle, watch again. All Manrope. */}
            <View style={styles.body}>
                <View style={styles.labelRow}>
                    <Ionicons name={glyph} size={14} color={palette.textSecondary} />
                    <Text style={[styles.label, { color: palette.textSecondary }]} numberOfLines={1}>
                        {label}
                    </Text>
                </View>
                {handle ? (
                    <Text style={[styles.handle, { color: palette.textMuted }]} numberOfLines={1}>
                        @{handle}
                    </Text>
                ) : null}
                <WatchAgainLink source={source} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        borderRadius: Radius.lg,
        padding: Spacing.md,
    },
    thumb: {
        width: THUMB_W,
        height: THUMB_H,
        borderRadius: Radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    thumbImg: {
        width: THUMB_W,
        height: THUMB_H,
    },
    body: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    label: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13.5,
        flexShrink: 1,
    },
    handle: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12.5,
    },
    watchRow: {
        alignSelf: 'flex-start',
        marginTop: 2,
    },
    watchText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12.5,
        letterSpacing: 0.2,
    },
});
