/**
 * InfoTab — info tab for restaurant page v3.
 *
 * Structure:
 *   - Map preview (tap → device maps)
 *   - Action row: Get Directions + Copy Address
 *   - Grouped info rows: Where / When / Reach / Basics
 *   - Footnote (dashed top, italic serif): "First logged by your table — Mar 2025."
 */
import React from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Platform,
    Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InfoMapPreview } from './InfoMapPreview';
import type { PlaceDetails, RestaurantPageRestaurant } from '@/hooks/restaurants/useRestaurantPage';

/** Cross-platform dashed horizontal rule using repeating dash segments. */
function DashedRule({ color }: { color: string }) {
    return (
        <View style={dashedRuleStyles.wrap} pointerEvents="none">
            {Array.from({ length: 40 }).map((_, i) => (
                <View key={i} style={[dashedRuleStyles.dash, { backgroundColor: color }]} />
            ))}
        </View>
    );
}

const dashedRuleStyles = StyleSheet.create({
    wrap: {
        flexDirection: 'row',
        overflow: 'hidden',
        height: 1,
        gap: 3,
    },
    dash: {
        width: 6,
        height: 1,
    },
});

interface Props {
    restaurant: RestaurantPageRestaurant;
    placeDetails: PlaceDetails;
    tablesCountWithLogs: number;
    firstLoggedAtByYourTable: string | null;
}

type Palette = typeof Colors.light;

// Ink-tone rule for group separators (spec: "thin ink-rule"), not the warm dusty-rose tone.
const RULE_COLOR = 'rgba(28, 28, 25, 0.12)';
const DIVIDER_STRONG = 'rgba(28, 28, 25, 0.18)';

function formatMonthYear(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch {
        return iso;
    }
}

function priceTierLabel(level: number | null): string {
    if (level == null) return '';
    const tier = '$'.repeat(Math.max(1, Math.min(4, level)));
    const labels: Record<number, string> = { 1: 'inexpensive', 2: 'affordable', 3: 'moderate', 4: 'upscale' };
    const lbl = labels[level] ?? '';
    return lbl ? `${tier} — ${lbl}` : tier;
}

interface InfoGroupProps {
    label: string;
    rows: { key: string; label: string; value: string; isLink?: boolean }[];
    palette: Palette;
    onLinkPress?: (key: string, value: string) => void;
}

function InfoGroup({ label, rows, palette, onLinkPress }: InfoGroupProps) {
    if (rows.length === 0) return null;
    return (
        <View style={[styles.group, { borderTopColor: RULE_COLOR }]}>
            <Text style={[styles.groupLabel, { color: palette.textMuted }]}>{label.toUpperCase()}</Text>
            {rows.map((row, i) => (
                <Pressable
                    key={row.key}
                    onPress={row.isLink && onLinkPress ? () => onLinkPress(row.key, row.value) : undefined}
                    style={[
                        styles.infoRow,
                        i < rows.length - 1 && { borderBottomColor: RULE_COLOR, borderBottomWidth: 1 },
                    ]}
                >
                    <Text style={[styles.infoLabel, { color: palette.textMuted }]}>{row.label.toUpperCase()}</Text>
                    <Text
                        style={[
                            styles.infoValue,
                            { color: row.isLink ? palette.primary : palette.text },
                        ]}
                        numberOfLines={2}
                    >
                        {row.value}{row.isLink ? ' ›' : ''}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

export function InfoTab({ restaurant, placeDetails, tablesCountWithLogs, firstLoggedAtByYourTable }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const lat = placeDetails.lat;
    const lng = placeDetails.lng;
    const addressLine = [restaurant.address, restaurant.city, restaurant.country].filter(Boolean).join(', ');

    const handleGetDirections = () => {
        if (lat != null && lng != null) {
            const label = encodeURIComponent(restaurant.name);
            const url = Platform.OS === 'ios'
                ? `maps:?q=${label}&ll=${lat},${lng}&dirflg=d`
                : `google.navigation:q=${lat},${lng}`;
            Linking.openURL(url).catch(() => {
                Linking.openURL(`https://maps.google.com/maps?daddr=${lat},${lng}`);
            });
        } else if (addressLine) {
            const encoded = encodeURIComponent(addressLine);
            const url = Platform.OS === 'ios'
                ? `maps:?daddr=${encoded}`
                : `google.navigation:q=${encoded}`;
            Linking.openURL(url).catch(() => {
                Linking.openURL(`https://maps.google.com/maps?daddr=${encoded}`);
            });
        }
    };

    const handleCopyAddress = () => {
        if (addressLine) {
            Clipboard.setStringAsync(addressLine).catch(() => {});
        }
    };

    const handleLinkPress = (key: string, value: string) => {
        if (key === 'website' || key === 'menu') {
            const url = value.startsWith('http') ? value : `https://${value}`;
            Linking.openURL(url).catch(() => {});
        } else if (key === 'phone') {
            Linking.openURL(`tel:${value.replace(/\s/g, '')}`).catch(() => {});
        }
    };

    // Where group
    const whereRows = [];
    if (restaurant.address) whereRows.push({ key: 'address', label: 'Address', value: restaurant.address });
    if (restaurant.city) whereRows.push({ key: 'area', label: 'Area', value: restaurant.city });

    // When group
    const whenRows = [];
    if (placeDetails.hours_today) {
        const openStr = placeDetails.open_now != null
            ? placeDetails.open_now ? ' — open now' : ' — closed'
            : '';
        whenRows.push({ key: 'today', label: 'Today', value: `${placeDetails.hours_today}${openStr}` });
    }

    // Reach group
    const reachRows = [];
    if (placeDetails.website) reachRows.push({ key: 'website', label: 'Website', value: placeDetails.website, isLink: true });
    if (placeDetails.phone) reachRows.push({ key: 'phone', label: 'Call', value: placeDetails.phone, isLink: true });
    if (placeDetails.menu_url) reachRows.push({ key: 'menu', label: 'Menu', value: 'View menu', isLink: true });

    // Basics group
    const basicsRows = [];
    if (restaurant.cuisine) basicsRows.push({ key: 'cuisine', label: 'Cuisine', value: restaurant.cuisine });
    if (restaurant.price_level != null) basicsRows.push({ key: 'price', label: 'Price', value: priceTierLabel(restaurant.price_level) });

    const canDirections = lat != null || !!restaurant.address;

    return (
        <View>
            {/* Map preview */}
            <InfoMapPreview
                lat={lat}
                lng={lng}
                address={addressLine}
                name={restaurant.name}
            />

            {/* Action row */}
            <View style={styles.actionRow}>
                <Pressable
                    onPress={canDirections ? handleGetDirections : undefined}
                    style={({ pressed }) => [
                        styles.actionBtn,
                        styles.actionBtnSolid,
                        { backgroundColor: pressed ? palette.textSecondary : palette.text, opacity: canDirections ? 1 : 0.4 },
                    ]}
                >
                    <Text style={[styles.actionBtnText, { color: palette.background }]}>
                        GET DIRECTIONS
                    </Text>
                </Pressable>
                <Pressable
                    onPress={addressLine ? handleCopyAddress : undefined}
                    style={({ pressed }) => [
                        styles.actionBtn,
                        styles.actionBtnGhost,
                        {
                            borderColor: DIVIDER_STRONG,
                            opacity: (addressLine && !pressed) ? 1 : pressed ? 0.7 : 0.4,
                        },
                    ]}
                >
                    <Text style={[styles.actionBtnText, { color: palette.text }]}>
                        COPY ADDRESS
                    </Text>
                </Pressable>
            </View>

            {/* Where */}
            <InfoGroup label="Where" rows={whereRows} palette={palette} />

            {/* When */}
            <InfoGroup label="When" rows={whenRows} palette={palette} />

            {/* Reach */}
            <InfoGroup label="Reach" rows={reachRows} palette={palette} onLinkPress={handleLinkPress} />

            {/* Basics */}
            <InfoGroup label="Basics" rows={basicsRows} palette={palette} />

            {/* Footnote */}
            {tablesCountWithLogs > 0 && firstLoggedAtByYourTable ? (
                <View style={styles.footnote}>
                    {/* Cross-platform dashed rule: borderStyle:'dashed' is unreliable on Android */}
                    <DashedRule color={DIVIDER_STRONG} />
                    <Text style={[styles.footnoteText, { color: palette.textMuted, marginTop: 12 }]}>
                        {'First logged by '}
                        <Text style={[styles.footnoteBold, { color: palette.textSecondary }]}>your table</Text>
                        {` — ${formatMonthYear(firstLoggedAtByYourTable)}. Now in `}
                        <Text style={[styles.footnoteBold, { color: palette.textSecondary }]}>
                            {tablesCountWithLogs} of your table{tablesCountWithLogs !== 1 ? 's' : ''}
                        </Text>
                        {'.'}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    actionRow: {
        flexDirection: 'row',
        gap: 8,
        marginHorizontal: 22,
        marginTop: 10,
    },
    actionBtn: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    actionBtnSolid: {},
    actionBtnGhost: {
        backgroundColor: 'transparent',
        borderWidth: 1,
    },
    actionBtnText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    group: {
        marginHorizontal: 22,
        marginTop: 20,
        paddingTop: 14,
        borderTopWidth: 1,
    },
    groupLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingVertical: 7,
        gap: 14,
    },
    infoLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1,
        textTransform: 'uppercase',
        flexShrink: 0,
        paddingTop: 2,
        minWidth: 64,
    },
    infoValue: {
        flex: 1,
        textAlign: 'right',
        fontFamily: 'Newsreader_400Regular',
        fontSize: 14,
        lineHeight: 20,
    },
    footnote: {
        marginHorizontal: 22,
        marginTop: 20,
        marginBottom: 8,
    },
    footnoteText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        lineHeight: 18,
    },
    footnoteBold: {
        fontFamily: 'Newsreader_600SemiBold',
        fontStyle: 'normal',
    },
});
