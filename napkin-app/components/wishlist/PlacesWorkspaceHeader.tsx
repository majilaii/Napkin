/**
 * PlacesWorkspaceHeader — persistent chrome for the Map-first saved-places
 * workspace. Map/List changes only the presentation; Imports and collections
 * stay reachable in either view.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';

export const PLACES_WORKSPACE_HEADER_HEIGHT = 112;

interface Props {
    topInset: number;
    viewMode: 'map' | 'list';
    section: 'places' | 'lists';
    listsCount: number;
    filtersActive: boolean;
    palette: typeof Colors.light;
    onSelectView: (mode: 'map' | 'list') => void;
    onOpenFilters: () => void;
    onToggleLists: () => void;
    onImport: () => void;
}

export function PlacesWorkspaceHeader({
    topInset,
    viewMode,
    section,
    listsCount,
    filtersActive,
    palette,
    onSelectView,
    onOpenFilters,
    onToggleLists,
    onImport,
}: Props) {
    const listsOpen = section === 'lists';

    return (
        <View
            style={[
                styles.root,
                Shadow.ambient,
                { backgroundColor: palette.background, paddingTop: topInset + Spacing.sm },
            ]}
        >
            <View style={styles.titleRow}>
                <Text style={[styles.title, { color: palette.text }]}>Places</Text>
                <Pressable
                    onPress={onImport}
                    style={({ pressed }) => [
                        styles.importButton,
                        {
                            backgroundColor: palette.primary,
                            opacity: pressed ? 0.9 : 1,
                            transform: [{ scale: pressed ? 0.96 : 1 }],
                        },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="import places"
                >
                    <Ionicons name="download-outline" size={16} color={palette.textInverse} />
                    <Text style={[styles.importLabel, { color: palette.textInverse }]}>Import</Text>
                </Pressable>
            </View>

            <View style={styles.toolbar}>
                <View style={[styles.viewToggle, { backgroundColor: palette.surfaceJournalHi }]}>
                    {(['map', 'list'] as const).map((mode) => {
                        const selected = viewMode === mode;
                        return (
                            <Pressable
                                key={mode}
                                onPress={() => onSelectView(mode)}
                                style={({ pressed }) => [
                                    styles.viewButton,
                                    selected && [Shadow.clip, { backgroundColor: palette.surfaceNote }],
                                    {
                                        opacity: pressed ? 0.82 : 1,
                                        transform: [{ scale: pressed ? 0.96 : 1 }],
                                    },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={`${mode} view`}
                                accessibilityState={{ selected }}
                            >
                                <Ionicons
                                    name={mode === 'map' ? 'map-outline' : 'list-outline'}
                                    size={15}
                                    color={selected ? palette.primary : palette.textSecondary}
                                />
                                <Text
                                    style={[
                                        styles.viewLabel,
                                        { color: selected ? palette.primary : palette.textSecondary },
                                    ]}
                                >
                                    {mode === 'map' ? 'Map' : 'List'}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>

                <View style={styles.secondaryActions}>
                    {!listsOpen ? (
                        <Pressable
                            onPress={onOpenFilters}
                            style={({ pressed }) => [
                                styles.secondaryButton,
                                {
                                    backgroundColor: filtersActive
                                        ? palette.primaryMuted
                                        : palette.surfaceJournalHi,
                                    opacity: pressed ? 0.82 : 1,
                                    transform: [{ scale: pressed ? 0.96 : 1 }],
                                },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="filters"
                        >
                            <Ionicons
                                name="options-outline"
                                size={15}
                                color={filtersActive ? palette.primary : palette.textSecondary}
                            />
                            <Text
                                style={[
                                    styles.secondaryLabel,
                                    { color: filtersActive ? palette.primary : palette.textSecondary },
                                ]}
                            >
                                Filter
                            </Text>
                            {filtersActive ? (
                                <View style={[styles.activeDot, { backgroundColor: palette.primary }]} />
                            ) : null}
                        </Pressable>
                    ) : null}

                    <Pressable
                        onPress={onToggleLists}
                        style={({ pressed }) => [
                            styles.secondaryButton,
                            {
                                backgroundColor: listsOpen
                                    ? palette.primaryMuted
                                    : palette.surfaceJournalHi,
                                opacity: pressed ? 0.82 : 1,
                                transform: [{ scale: pressed ? 0.96 : 1 }],
                            },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={listsOpen ? 'show saved places' : 'show lists'}
                        accessibilityState={{ selected: listsOpen }}
                    >
                        <Ionicons
                            name={listsOpen ? 'bookmark-outline' : 'albums-outline'}
                            size={15}
                            color={listsOpen ? palette.primary : palette.textSecondary}
                        />
                        <Text
                            style={[
                                styles.secondaryLabel,
                                { color: listsOpen ? palette.primary : palette.textSecondary },
                            ]}
                        >
                            {listsOpen ? 'Saved' : `Lists · ${listsCount}`}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        gap: Spacing.sm,
        paddingHorizontal: 12,
        paddingBottom: Spacing.sm,
    },
    titleRow: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.sm,
    },
    title: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 28,
        lineHeight: 32,
        letterSpacing: -0.4,
    },
    importButton: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        paddingLeft: 15,
        paddingRight: 13,
        borderRadius: Radius.full,
    },
    importLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.3,
    },
    toolbar: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
    },
    viewToggle: {
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        borderRadius: Radius.full,
    },
    viewButton: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingHorizontal: 10,
        borderRadius: Radius.full,
    },
    viewLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.2,
    },
    secondaryActions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 6,
        flexShrink: 1,
    },
    secondaryButton: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingHorizontal: 10,
        borderRadius: Radius.full,
    },
    secondaryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.15,
    },
    activeDot: {
        width: 5,
        height: 5,
        borderRadius: Radius.full,
    },
});
