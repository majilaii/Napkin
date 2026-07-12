/**
 * ClipThumb — the clip cover thumbnail, with a platform-logo plate fallback at the
 * IDENTICAL footprint (TICKET-181). Leads every imports-hub row (thumbnail-first)
 * and mirrors the ImportSourceCard treatment: a warm-paper plate, hairline outline,
 * radius. The provider cover URL rots in hours–days, so a load failure — OR an
 * absent url (a "reading" row has no thumb yet) — degrades to the source glyph on a
 * plate, never a broken-image box, never a reflow (the ClippingCard `imgFailed`
 * pattern).
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

interface Props {
    thumbUrl: string | null | undefined;
    /** Source logo glyph shown on the plate when there's no cover (importSourceIcon). */
    glyph: React.ComponentProps<typeof Ionicons>['name'];
    width?: number;
    height?: number;
    radius?: number;
    iconSize?: number;
    palette?: Palette;
}

export function ClipThumb({
    thumbUrl,
    glyph,
    width = 46,
    height = 58,
    radius = 9,
    iconSize = 18,
    palette: paletteProp,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? (Colors[scheme] as Palette);
    const [failed, setFailed] = useState(false);

    // A recycled row that swaps in a fresh url must retry the image (never stay
    // latched on the previous url's failure).
    useEffect(() => setFailed(false), [thumbUrl]);

    const showPhoto = !!thumbUrl && !failed;

    return (
        <View
            style={[
                styles.plate,
                {
                    width,
                    height,
                    borderRadius: radius,
                    backgroundColor: palette.surfaceJournalLow,
                    borderColor: palette.outlineVariant,
                },
            ]}
        >
            {showPhoto ? (
                <ExpoImage
                    source={{ uri: thumbUrl as string }}
                    style={{ width, height }}
                    contentFit="cover"
                    recyclingKey={thumbUrl as string}
                    transition={120}
                    onError={() => setFailed(true)}
                />
            ) : (
                <Ionicons name={glyph} size={iconSize} color={palette.textMuted} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    plate: {
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
    },
});

export default ClipThumb;
