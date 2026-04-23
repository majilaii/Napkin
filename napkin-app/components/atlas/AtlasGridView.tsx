/**
 * AtlasGridView — 2-column Pinterest-style masonry of RestaurantTiles.
 *
 * Staggered heights to create visual rhythm. Alternates between
 * ~200px left column and ~170px right column tiles.
 *
 * Wireframe: atlas-canvas.html .photo-masonry
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { RestaurantTile } from './RestaurantTile';
import type { AtlasRestaurantTile } from '@/hooks/tables/useTableAtlasCity';

interface Props {
    tiles: AtlasRestaurantTile[];
    onTilePress: (restaurantId: string) => void;
    palette?: typeof Colors.light;
}

// Alternate heights for visual masonry rhythm
const LEFT_HEIGHTS = [200, 170, 210, 175, 195];
const RIGHT_HEIGHTS = [170, 200, 175, 215, 165];

export function AtlasGridView({ tiles, onTilePress, palette: paletteProp }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? Colors[scheme];

    // Split into two columns
    const { leftCol, rightCol } = useMemo(() => {
        const left: AtlasRestaurantTile[] = [];
        const right: AtlasRestaurantTile[] = [];
        tiles.forEach((tile, i) => {
            if (i % 2 === 0) left.push(tile);
            else right.push(tile);
        });
        return { leftCol: left, rightCol: right };
    }, [tiles]);

    return (
        <View style={styles.masonry}>
            {/* Left column */}
            <View style={styles.col}>
                {leftCol.map((tile, i) => (
                    <View key={tile.id} style={styles.tileWrap}>
                        <RestaurantTile
                            tile={tile}
                            onPress={() => onTilePress(tile.id)}
                            heroHeight={LEFT_HEIGHTS[i % LEFT_HEIGHTS.length]}
                            palette={palette}
                        />
                    </View>
                ))}
            </View>

            {/* Right column */}
            <View style={styles.col}>
                {rightCol.map((tile, i) => (
                    <View key={tile.id} style={styles.tileWrap}>
                        <RestaurantTile
                            tile={tile}
                            onPress={() => onTilePress(tile.id)}
                            heroHeight={RIGHT_HEIGHTS[i % RIGHT_HEIGHTS.length]}
                            palette={palette}
                        />
                    </View>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    masonry: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        gap: 10,
        paddingBottom: Spacing.md,
    },
    col: {
        flex: 1,
        gap: 10,
    },
    tileWrap: {
        // Individual tile wrapper — no extra style needed
    },
});

export default AtlasGridView;
