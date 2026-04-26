/**
 * InfoMapPreview — static map preview with terracotta pin.
 *
 * 128px tall, rounded-10, subtle grid pattern + centered pin.
 * Tap opens device maps app at lat/lng.
 */
import React from 'react';
import { View, Pressable, StyleSheet, Platform, Linking } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    lat: number | null;
    lng: number | null;
    address?: string | null;
    name?: string | null;
}

type Palette = typeof Colors.light;

export function InfoMapPreview({ lat, lng, address, name }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const handlePress = () => {
        if (lat != null && lng != null) {
            const label = encodeURIComponent(name ?? address ?? 'Restaurant');
            const url = Platform.OS === 'ios'
                ? `maps:?q=${label}&ll=${lat},${lng}`
                : `geo:${lat},${lng}?q=${label}`;
            Linking.openURL(url).catch(() => {
                // fallback to Google Maps web
                Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);
            });
        } else if (address) {
            const encoded = encodeURIComponent(address);
            const url = Platform.OS === 'ios'
                ? `maps:?q=${encoded}`
                : `geo:0,0?q=${encoded}`;
            Linking.openURL(url).catch(() => {
                Linking.openURL(`https://maps.google.com/?q=${encoded}`);
            });
        }
    };

    const isInteractive = lat != null || !!address;

    return (
        <Pressable
            onPress={isInteractive ? handlePress : undefined}
            style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
        >
            <View style={[styles.map, { borderColor: 'rgba(0,0,0,0.08)' }]}>
                {/* Grid lines via pseudo via absolute views */}
                <GridLines />
                {/* Centered pin */}
                <View style={styles.pinWrap}>
                    <View style={[styles.pin, { backgroundColor: palette.primary }]}>
                        <View style={[styles.pinDot, { backgroundColor: palette.background }]} />
                    </View>
                </View>
            </View>
        </Pressable>
    );
}

function GridLines() {
    const lineColor = 'rgba(138, 114, 108, 0.16)';

    const cols = 6;
    const rows = 4;

    return (
        <>
            {Array.from({ length: cols - 1 }).map((_, i) => (
                <View
                    key={`col-${i}`}
                    style={[
                        styles.gridLine,
                        styles.gridLineV,
                        {
                            left: `${((i + 1) / cols) * 100}%`,
                            backgroundColor: lineColor,
                        },
                    ]}
                />
            ))}
            {Array.from({ length: rows - 1 }).map((_, i) => (
                <View
                    key={`row-${i}`}
                    style={[
                        styles.gridLine,
                        styles.gridLineH,
                        {
                            top: `${((i + 1) / rows) * 100}%`,
                            backgroundColor: lineColor,
                        },
                    ]}
                />
            ))}
        </>
    );
}

const styles = StyleSheet.create({
    map: {
        height: 128,
        marginHorizontal: 22,
        marginTop: 18,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#e8ddc0',
        borderWidth: 1,
        position: 'relative',
    },
    gridLine: {
        position: 'absolute',
        backgroundColor: 'rgba(138, 114, 108, 0.16)',
    },
    gridLineV: {
        width: 1,
        top: 0,
        bottom: 0,
    },
    gridLineH: {
        height: 1,
        left: 0,
        right: 0,
    },
    pinWrap: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: [{ translateX: -7 }, { translateY: -14 }],
    },
    pin: {
        width: 14,
        height: 14,
        borderRadius: 7,
        // Map pin shape: rotated square with rounded corners
        // We can approximate with a teardrop using borderRadius + rotation
        borderBottomLeftRadius: 0,
        transform: [{ rotate: '-45deg' }],
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
        elevation: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pinDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        // counteract rotation to keep dot upright
        transform: [{ rotate: '45deg' }],
    },
});
