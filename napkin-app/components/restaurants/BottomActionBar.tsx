/**
 * BottomActionBar — sticky action strip for the restaurant page.
 *
 * Primary pill: terracotta "+ Log a visit" (or "Log again" once the user has
 * logged at least once). Secondary pill: outline "Pin" with location-pin glyph
 * that flips to terracotta fill when saved to the wishlist.
 *
 * The bar pins to the bottom and fades upward into the page background so the
 * scroll content doesn't butt against a hard edge.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

interface Props {
    loggedBefore: boolean;
    onLogPress: () => void;
    pinned: boolean;
    onPinPress: () => void;
    pinDisabled?: boolean;
}

function withAlpha(hex: string, alpha: number): string {
    // Not a true alpha blender — expects a 6-digit hex and returns `${hex}${alphaHex}`.
    // We use it to derive the gradient fade color from the page background.
    const aa = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `${hex}${aa}`;
}

export function BottomActionBar({
    loggedBefore,
    onLogPress,
    pinned,
    onPinPress,
    pinDisabled,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();

    const cream = '#f6ecd9';
    const bg = palette.background;

    return (
        <View
            pointerEvents="box-none"
            style={[styles.container, { paddingBottom: Math.max(insets.bottom, 14) + 10 }]}
        >
            {/* Fade into page background */}
            <LinearGradient
                colors={[withAlpha(bg, 0), withAlpha(bg, 0.85), bg]}
                locations={[0, 0.4, 1]}
                style={styles.gradient}
                pointerEvents="none"
            />

            <View style={styles.row}>
                <Pressable
                    onPress={onLogPress}
                    style={({ pressed }) => [
                        styles.primaryBtn,
                        {
                            backgroundColor: pressed
                                ? palette.primaryContainer
                                : palette.primary,
                        },
                    ]}
                >
                    <Text style={[styles.plusGlyph, { color: cream }]}>+</Text>
                    <Text style={[styles.primaryLabel, { color: cream }]}>
                        {loggedBefore ? 'Log again' : 'Log a visit'}
                    </Text>
                </Pressable>

                <Pressable
                    onPress={onPinPress}
                    disabled={pinDisabled}
                    style={({ pressed }) => [
                        styles.pinBtn,
                        {
                            backgroundColor: palette.card,
                            borderColor: 'rgba(28,28,25,0.1)',
                            opacity: pinDisabled ? 0.5 : pressed ? 0.85 : 1,
                        },
                    ]}
                >
                    <Ionicons
                        name={pinned ? 'location' : 'location-outline'}
                        size={13}
                        color={pinned ? palette.primary : palette.text}
                    />
                    <Text
                        style={[
                            styles.pinLabel,
                            { color: pinned ? palette.primary : palette.text },
                        ]}
                    >
                        {pinned ? 'Pinned' : 'Pin'}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: 14,
        paddingHorizontal: 18,
    },
    gradient: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        top: -40,
    },
    row: {
        flexDirection: 'row',
        gap: 8,
    },
    primaryBtn: {
        flex: 1,
        paddingVertical: 13,
        borderRadius: 999,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    plusGlyph: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 16,
        lineHeight: 18,
    },
    primaryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    pinBtn: {
        paddingVertical: 13,
        paddingHorizontal: 16,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    pinLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
});
