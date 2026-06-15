/**
 * MetaActions — quiet metadata row on the restaurant page (TICKET-081).
 *
 * Renders below the CTA row, above the photo / FROM YOUR TABLE:
 *   - an action row of affordances (call · directions · website), each present
 *     only when its datum exists
 *   - a quiet hours line for today, tappable to expand the full week
 *
 * Heirloom Journal rules:
 *   - Ionicons outline @ 22, lowercase Manrope labels, theme tokens only
 *   - no emoji, no hard 1px borders, ambient structure (spacing + background)
 *   - website is the ONLY web affordance — no "menu" (Places has no menu source)
 *
 * Omits ENTIRELY (returns null) when there is no actionable metadata — a
 * ghost / no-external_id restaurant shows nothing here (no empty rows, no gap).
 */
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    hasHours,
    todaysHoursLine,
    weekHoursLines,
    type RestaurantHours,
} from '@/lib/restaurantHours';

type Palette = typeof Colors.light;

interface MetaActionsProps {
    phone: string | null;
    website: string | null;
    googleMapsUri: string | null;
    hours: RestaurantHours | null;
    /** Used to build a maps-search fallback URL when there's no googleMapsUri. */
    name: string;
    city: string | null;
}

function openUrl(url: string) {
    Linking.openURL(url).catch(() => {
        // Quiet failure — no alert. A dead link shouldn't shout on a journal page.
    });
}

/** Maps-search fallback when we have no canonical googleMapsUri. */
function mapsSearchUrl(name: string, city: string | null): string {
    const q = encodeURIComponent([name, city].filter(Boolean).join(' '));
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

interface ActionProps {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    palette: Palette;
    /** 'pill' = bordered terracotta affordance with label (directions);
     *  'icon' = quiet icon-only (call / website). */
    variant: 'pill' | 'icon';
}

function Action({ icon, label, onPress, palette, variant }: ActionProps) {
    if (variant === 'pill') {
        return (
            <Pressable
                onPress={onPress}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={label}
                style={({ pressed }) => [
                    styles.pill,
                    { borderColor: 'rgba(160,63,40,0.35)', opacity: pressed ? 0.7 : 1 },
                ]}
            >
                <Ionicons name={icon} size={16} color={palette.primary} />
                <Text style={[styles.pillLabel, { color: palette.primary }]}>{label}</Text>
            </Pressable>
        );
    }
    return (
        <Pressable
            onPress={onPress}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
            <Ionicons name={icon} size={20} color={palette.textSecondary} />
        </Pressable>
    );
}

export function MetaActions({ phone, website, googleMapsUri, hours, name, city }: MetaActionsProps) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const [expanded, setExpanded] = useState(false);

    const hasCall = !!phone && phone.trim() !== '';
    // Directions always resolvable to a maps search; but only show it when we have
    // either a canonical uri OR something to search for (a name — always true).
    const hasDirections = (!!googleMapsUri && googleMapsUri.trim() !== '') || !!name?.trim();
    const hasWebsite = !!website && website.trim() !== '';
    const showHours = hasHours(hours);

    const hasAnyAction = hasCall || hasDirections || hasWebsite;

    // Omit entirely — no empty rows, no gap (the bug we just fixed elsewhere).
    if (!hasAnyAction && !showHours) return null;

    const todayLine = todaysHoursLine(hours);
    const week = expanded ? weekHoursLines(hours) : [];

    return (
        <View style={styles.container}>
            {hasAnyAction ? (
                <View style={styles.actionRow}>
                    {hasDirections ? (
                        <Action
                            variant="pill"
                            icon="navigate-outline"
                            label="directions"
                            onPress={() =>
                                openUrl(
                                    googleMapsUri && googleMapsUri.trim() !== ''
                                        ? googleMapsUri
                                        : mapsSearchUrl(name, city),
                                )
                            }
                            palette={palette}
                        />
                    ) : null}
                    {hasCall ? (
                        <Action
                            variant="icon"
                            icon="call-outline"
                            label="call"
                            onPress={() => openUrl(`tel:${phone!.replace(/\s/g, '')}`)}
                            palette={palette}
                        />
                    ) : null}
                    {hasWebsite ? (
                        <Action
                            variant="icon"
                            icon="globe-outline"
                            label="website"
                            onPress={() => {
                                const url = website!.startsWith('http') ? website! : `https://${website}`;
                                openUrl(url);
                            }}
                            palette={palette}
                        />
                    ) : null}
                </View>
            ) : null}

            {showHours && todayLine ? (
                <Pressable
                    onPress={() => setExpanded(v => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={expanded ? 'collapse hours' : 'show full week hours'}
                    style={styles.hoursToday}
                >
                    <Ionicons
                        name="time-outline"
                        size={15}
                        color={palette.textMuted}
                        style={styles.hoursIcon}
                    />
                    <Text style={[styles.hoursTodayText, { color: palette.textMuted }]} numberOfLines={1}>
                        {todayLine}
                    </Text>
                    <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={13}
                        color={palette.textMuted}
                    />
                </Pressable>
            ) : null}

            {expanded && week.length > 0 ? (
                <View style={styles.weekBlock}>
                    {week.map((line, i) => (
                        <View key={i} style={styles.weekRow}>
                            <Text
                                style={[
                                    styles.weekDay,
                                    { color: line.isToday ? palette.text : palette.textMuted },
                                ]}
                            >
                                {line.day}
                            </Text>
                            <Text
                                style={[
                                    styles.weekHours,
                                    { color: line.isToday ? palette.text : palette.textMuted },
                                ]}
                            >
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
    container: {
        paddingHorizontal: 24,
        gap: 12,
    },
    actionRow: {
        flexDirection: 'row',
        gap: 14,
        alignItems: 'center',
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1.5,
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 7,
    },
    pillLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.2,
    },
    iconBtn: {
        padding: 4,
    },
    hoursToday: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    hoursIcon: {
        marginRight: 0,
    },
    hoursTodayText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        flexShrink: 1,
    },
    weekBlock: {
        gap: 6,
        paddingLeft: 21, // align under the hours text (icon width + gap)
    },
    weekRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
    },
    weekDay: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
    weekHours: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 13,
    },
});
