/**
 * UtilityPills — Call · Website · Directions, centered under the hero
 * (design 2a). Each pill renders only when its datum exists; directions is
 * always resolvable (canonical google_maps_uri, else a maps search).
 *
 * Carries the quiet hours line beneath (tap toggles the full week) — the one
 * useful Places datum the pills don't hold.
 */
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import {
    hasHours,
    todaysHoursLine,
    weekHoursLines,
    type RestaurantHours,
} from '@/lib/restaurantHours';

type Palette = typeof Colors.light;

interface Props {
    phone: string | null;
    website: string | null;
    googleMapsUri: string | null;
    name: string;
    city: string | null;
    hours: RestaurantHours | null;
    palette: Palette;
}

function openUrl(url: string) {
    Linking.openURL(url).catch(() => {
        // Quiet failure — a dead link shouldn't shout on a journal page.
    });
}

/** One canonical directions URL — pills and any future caller must agree. */
export function resolveDirectionsUrl(
    googleMapsUri: string | null,
    name: string,
    city: string | null,
): string {
    if (googleMapsUri && googleMapsUri.trim() !== '') return googleMapsUri;
    const q = encodeURIComponent([name, city].filter(Boolean).join(' '));
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

interface PillProps {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    palette: Palette;
    borderColor: string;
}

function Pill({ icon, label, onPress, palette, borderColor }: PillProps) {
    return (
        <Pressable
            onPress={onPress}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [styles.pill, { borderColor, opacity: pressed ? 0.6 : 1 }]}
        >
            <Ionicons name={icon} size={12} color={palette.textSecondary} />
            <Text style={[styles.pillLabel, { color: palette.textSecondary }]}>{label}</Text>
        </Pressable>
    );
}

export function UtilityPills({ phone, website, googleMapsUri, name, city, hours, palette }: Props) {
    const [expanded, setExpanded] = useState(false);

    // App is light-locked (use-color-scheme forces 'light'); ink hairline per canvas.
    const borderColor = 'rgba(28,28,25,0.12)';
    const hasCall = !!phone && phone.trim() !== '';
    const hasWebsite = !!website && website.trim() !== '';
    const showHours = hasHours(hours);
    const todayLine = showHours ? todaysHoursLine(hours) : null;
    const week = expanded ? weekHoursLines(hours) : [];

    return (
        <View style={styles.wrap}>
            <View style={styles.row}>
                {hasCall ? (
                    <Pill
                        icon="call-outline"
                        label="Call"
                        onPress={() => openUrl(`tel:${phone!.replace(/\s/g, '')}`)}
                        palette={palette}
                        borderColor={borderColor}
                    />
                ) : null}
                {hasWebsite ? (
                    <Pill
                        icon="globe-outline"
                        label="Website"
                        onPress={() => openUrl(website!.startsWith('http') ? website! : `https://${website}`)}
                        palette={palette}
                        borderColor={borderColor}
                    />
                ) : null}
                <Pill
                    icon="navigate-outline"
                    label="Directions"
                    onPress={() => openUrl(resolveDirectionsUrl(googleMapsUri, name, city))}
                    palette={palette}
                    borderColor={borderColor}
                />
                <Pill
                    icon="calendar-outline"
                    label="Reserve"
                    onPress={() =>
                        openUrl(
                            `https://www.opentable.com/s?term=${encodeURIComponent(
                                [name, city].filter(Boolean).join(' '),
                            )}`,
                        )
                    }
                    palette={palette}
                    borderColor={borderColor}
                />
            </View>

            {todayLine ? (
                <Pressable
                    onPress={() => setExpanded((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={expanded ? 'collapse hours' : 'show full week hours'}
                    style={styles.hoursRow}
                >
                    <Text style={[styles.hoursText, { color: palette.textMuted }]} numberOfLines={1}>
                        {todayLine}
                    </Text>
                    <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={11}
                        color={palette.textMuted}
                    />
                </Pressable>
            ) : null}

            {expanded && week.length > 0 ? (
                <View style={styles.weekBlock}>
                    {week.map((line, i) => (
                        <View key={i} style={styles.weekRow}>
                            <Text style={[styles.weekDay, { color: line.isToday ? palette.text : palette.textMuted }]}>
                                {line.day}
                            </Text>
                            <Text style={[styles.weekHours, { color: line.isToday ? palette.text : palette.textMuted }]}>
                                {line.hours}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        gap: 8,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 20,
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
    },
    pillLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11.5,
    },
    hoursRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
    },
    hoursText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    weekBlock: {
        gap: 6,
        paddingHorizontal: 40,
        paddingTop: 2,
    },
    weekRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
    },
    weekDay: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12.5,
    },
    weekHours: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 12.5,
    },
});

export default UtilityPills;
