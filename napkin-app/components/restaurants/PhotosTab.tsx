/**
 * PhotosTab — two-section photo grid for restaurant page v3.
 *
 * Section 1: "From your table · N" — 3-col grid
 *   - Your own photos: olive tag background
 *   - Tablemate photos: terracotta tag background
 *
 * Em-dash serif divider between sections.
 *
 * Section 2: "From other folks · N" — 3-col grid
 *   - Dark tags with @handle style
 *
 * Dashed bottom note: "— what they ordered coming later"
 */
import React from 'react';
import { View, Text, Image, StyleSheet, Dimensions } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PhotoItem } from '@/hooks/restaurants/useRestaurantPage';

interface Props {
    fromYourTable: PhotoItem[];
    fromOthers: PhotoItem[];
    hasTable: boolean;
}

type Palette = typeof Colors.light;

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 3;
const CELL_SIZE = (SCREEN_WIDTH - GRID_GAP * 2) / 3;

function PhotoCell({
    item,
    isTable,
    palette,
}: {
    item: PhotoItem;
    isTable: boolean;
    palette: Palette;
}) {
    const tagBg = isTable
        ? item.is_self
            ? 'rgba(107, 124, 58, 0.85)'  // olive for self
            : 'rgba(160, 63, 40, 0.85)'   // terracotta for tablemate
        : 'rgba(28, 28, 25, 0.55)';       // dark for public

    const tagLabel = isTable
        ? item.is_self
            ? 'You'
            : item.author_display_name
        : item.author_handle;

    return (
        <View style={styles.cell}>
            <Image
                source={{ uri: item.url }}
                style={styles.cellImage}
                resizeMode="cover"
            />
            <View style={[styles.tag, { backgroundColor: tagBg }]}>
                <Text style={styles.tagText} numberOfLines={1}>
                    {tagLabel}
                </Text>
            </View>
        </View>
    );
}

const RULE_COLOR = 'rgba(138, 114, 108, 0.3)';
const DASHED_RULE_COLOR = 'rgba(221, 192, 186, 0.4)';

export function PhotosTab({ fromYourTable, fromOthers, hasTable }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const showTableSection = hasTable && fromYourTable.length > 0;
    const showOthersSection = fromOthers.length > 0;

    if (!showTableSection && !showOthersSection) {
        return (
            <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                    No photos yet.
                </Text>
            </View>
        );
    }

    return (
        <View>
            {/* From your table */}
            {showTableSection ? (
                <View style={styles.section}>
                    <View style={styles.secRow}>
                        <Text style={[styles.secLabel, { color: palette.textMuted }]}>
                            From your table
                        </Text>
                        <Text style={[styles.secCount, { color: palette.textSecondary }]}>
                            {fromYourTable.length}
                        </Text>
                    </View>
                    <View style={styles.grid}>
                        {fromYourTable.map((item, idx) => (
                            <PhotoCell
                                key={`table-${item.entry_id}-${idx}`}
                                item={item}
                                isTable
                                palette={palette}
                            />
                        ))}
                    </View>
                </View>
            ) : null}

            {/* Em-dash serif divider */}
            {showTableSection && showOthersSection ? (
                <View style={styles.sepWrap}>
                    <View style={[styles.sepLine, { backgroundColor: RULE_COLOR }]} />
                    <View style={[styles.sepEmDash, { backgroundColor: palette.background }]}>
                        <Text style={[styles.sepText, { color: palette.textMuted }]}>—</Text>
                    </View>
                </View>
            ) : null}

            {/* From other folks */}
            {showOthersSection ? (
                <View style={styles.section}>
                    <View style={styles.secRow}>
                        <Text style={[styles.secLabel, { color: palette.textMuted }]}>
                            From other folks
                        </Text>
                        <Text style={[styles.secCount, { color: palette.textSecondary }]}>
                            {fromOthers.length}
                        </Text>
                    </View>
                    <View style={styles.grid}>
                        {fromOthers.map((item, idx) => (
                            <PhotoCell
                                key={`pub-${item.entry_id}-${idx}`}
                                item={item}
                                isTable={false}
                                palette={palette}
                            />
                        ))}
                    </View>
                </View>
            ) : null}

            {/* Future placeholder */}
            <View style={[styles.futureLine, { borderTopColor: DASHED_RULE_COLOR }]}>
                <Text style={[styles.futureText, { color: palette.textMuted }]}>
                    {'— '}
                    <Text style={{ fontStyle: 'italic' }}>what they ordered</Text>
                    {' coming later'}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        marginTop: 4,
    },
    secRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingHorizontal: 22,
        marginBottom: 10,
        paddingTop: 16,
    },
    secLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    secCount: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GRID_GAP,
    },
    cell: {
        width: CELL_SIZE,
        height: CELL_SIZE,
        position: 'relative',
        backgroundColor: '#d0c4b0',
    },
    cellImage: {
        width: '100%',
        height: '100%',
    },
    tag: {
        position: 'absolute',
        left: 5,
        bottom: 5,
        paddingHorizontal: 5,
        paddingVertical: 2,
        borderRadius: 2,
    },
    tagText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 8.5,
        letterSpacing: 0.4,
        color: '#fdf6ec',
        maxWidth: 80,
    },
    sepWrap: {
        marginHorizontal: 22,
        marginVertical: 22,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
    },
    sepLine: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 1,
    },
    sepEmDash: {
        paddingHorizontal: 10,
    },
    sepText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    futureLine: {
        marginHorizontal: 22,
        marginTop: 18,
        paddingTop: 10,
        borderTopWidth: 1,
        alignItems: 'center',
        marginBottom: 8,
    },
    futureText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 11.5,
    },
    empty: {
        paddingHorizontal: 22,
        paddingTop: 24,
    },
    emptyText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
});
