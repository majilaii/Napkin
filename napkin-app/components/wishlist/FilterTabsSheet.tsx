/**
 * FilterTabsSheet — one tabbed bottom-sheet for the Wishlist filters (TICKET-124).
 *
 * Replaces the pill-per-sheet strip (City · Cuisine · Price · Sort, each opening
 * its own FilterActionSheet) with ONE sheet whose top tab bar switches between
 * Cuisine · Price · Area · Sort over the same option-row rendering (terracotta
 * checkmark on the selected row). It re-presents the EXACT existing filter state
 * — no new backing data — so list mode and map mode stay in sync via the
 * unchanged buildMapPins `Filters` contract.
 *
 * Copy economy: uppercase-Manrope tab labels, terracotta accent only, no
 * explanatory sentences. Structure mirrors FilterActionSheet (RN core Modal,
 * transparent + slide, tap-the-scrim-to-dismiss, inner Pressable swallows taps).
 *
 * Selecting an option applies it live and leaves the sheet open — the point of
 * one sheet is to set several filters (and tab around) in a single session; the
 * scrim dismisses.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import type { FilterOption } from './FilterActionSheet';
import {
    type FilterTabKey,
    visibleFilterTabs,
    resolveActiveTab,
    defaultFilterTab,
    FILTER_TAB_LABELS,
} from './filterTabsUtils';

export interface FilterTabConfig {
    options: FilterOption[];
    selected: string | null;
    onSelect: (value: string | null) => void;
}

/** TICKET-134: a boolean "on the map" toggle (show saved / show been). */
export interface FilterToggleConfig {
    value: boolean;
    onToggle: () => void;
}

interface Props {
    visible: boolean;
    onDismiss: () => void;
    palette: typeof Colors.light;
    /** Map mode: hide the Sort tab (position is the signal on a map). */
    hideSort?: boolean;
    /** <2 cities in the saved set: hide the Area tab. */
    hideArea?: boolean;
    cuisine: FilterTabConfig;
    price: FilterTabConfig;
    area: FilterTabConfig;
    sort: FilterTabConfig;
    /** TICKET-134: Your-map only — show/hide the saved layer. Absent → no row. */
    showSaved?: FilterToggleConfig;
    /** TICKET-134: Your-map only — show/hide the been layer. Absent → no row. */
    showBeen?: FilterToggleConfig;
}

export function FilterTabsSheet({
    visible,
    onDismiss,
    palette,
    hideSort,
    hideArea,
    cuisine,
    price,
    area,
    sort,
    showSaved,
    showBeen,
}: Props) {
    const insets = useSafeAreaInsets();
    const visibility = { hideSort, hideArea };
    const [rawTab, setRawTab] = useState<FilterTabKey>(() => defaultFilterTab(visibility));

    const tabs = visibleFilterTabs(visibility);
    // Clamp a stale tab (e.g. was on Sort, then map mode hid it) to a visible one.
    const activeTab = resolveActiveTab(rawTab, visibility);

    const configByTab: Record<FilterTabKey, FilterTabConfig> = { cuisine, price, area, sort };
    const active = configByTab[activeTab];

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
            <Pressable style={styles.backdrop} onPress={onDismiss}>
                <Pressable
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: palette.surfaceNote,
                            paddingBottom: insets.bottom + Spacing.lg,
                        },
                    ]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View style={[styles.grabber, { backgroundColor: palette.ruleWarmNib }]} />

                    {/* Tab bar — uppercase Manrope, terracotta underline on active. */}
                    <View style={styles.tabBar}>
                        {tabs.map((key) => {
                            const isActive = key === activeTab;
                            return (
                                <Pressable
                                    key={key}
                                    onPress={() => setRawTab(key)}
                                    style={styles.tab}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: isActive }}
                                >
                                    <Text
                                        style={[
                                            styles.tabLabel,
                                            { color: isActive ? palette.primary : palette.textMuted },
                                        ]}
                                    >
                                        {FILTER_TAB_LABELS[key]}
                                    </Text>
                                    <View
                                        style={[
                                            styles.tabUnderline,
                                            { backgroundColor: isActive ? palette.primary : 'transparent' },
                                        ]}
                                    />
                                </Pressable>
                            );
                        })}
                    </View>

                    <ScrollView
                        style={styles.scroll}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {active.options.map((opt) => {
                            const selected = active.selected === opt.value;
                            return (
                                <Pressable
                                    key={opt.value ?? '__all__'}
                                    onPress={() => active.onSelect(opt.value)}
                                    style={styles.optionRow}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected }}
                                >
                                    <Text
                                        style={[
                                            styles.optionLabel,
                                            {
                                                color: selected ? palette.primary : palette.text,
                                                fontFamily: selected ? 'Manrope_700Bold' : 'Manrope_500Medium',
                                            },
                                        ]}
                                    >
                                        {opt.label}
                                        {opt.count != null ? (
                                            <Text style={{ color: palette.textMuted }}>{`  ${opt.count}`}</Text>
                                        ) : null}
                                    </Text>
                                    {selected ? (
                                        <Ionicons name="checkmark" size={18} color={palette.primary} />
                                    ) : null}
                                </Pressable>
                            );
                        })}
                    </ScrollView>

                    {/* On the map — Your-map layer toggles (TICKET-134). Rendered
                        only when the screen passes them; two boolean rows. */}
                    {showSaved || showBeen ? (
                        <View style={[styles.onMapSection, { borderTopColor: palette.dividerSoft }]}>
                            <Text style={[styles.onMapLabel, { color: palette.textMuted }]}>On the map</Text>
                            {showSaved ? (
                                <ToggleRow label="Saved" config={showSaved} palette={palette} />
                            ) : null}
                            {showBeen ? (
                                <ToggleRow label="Been" config={showBeen} palette={palette} />
                            ) : null}
                        </View>
                    ) : null}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

/** One boolean toggle row for the "On the map" section (TICKET-134). */
function ToggleRow({
    label,
    config,
    palette,
}: {
    label: string;
    config: FilterToggleConfig;
    palette: typeof Colors.light;
}) {
    return (
        <Pressable
            onPress={config.onToggle}
            style={styles.optionRow}
            accessibilityRole="switch"
            accessibilityState={{ checked: config.value }}
            accessibilityLabel={label}
        >
            <Text
                style={[
                    styles.optionLabel,
                    {
                        color: config.value ? palette.primary : palette.text,
                        fontFamily: config.value ? 'Manrope_700Bold' : 'Manrope_500Medium',
                    },
                ]}
            >
                {label}
            </Text>
            <Ionicons
                name={config.value ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={config.value ? palette.primary : palette.textMuted}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        // Warm dusk, not a black scrim (founder, 2026-07-03).
        backgroundColor: 'rgba(74,55,42,0.25)',
    },
    sheet: {
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingTop: 8,
    },
    grabber: {
        width: 40,
        height: 5,
        borderRadius: Radius.sm,
        alignSelf: 'center',
        opacity: 0.5,
        marginBottom: 4,
    },
    tabBar: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingTop: 8,
        gap: 6,
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        paddingTop: 8,
        gap: 8,
    },
    tabLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    tabUnderline: {
        height: 2,
        width: 22,
        borderRadius: 1,
    },
    scroll: {
        maxHeight: 360,
        marginTop: 4,
    },
    optionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 24,
    },
    optionLabel: {
        fontSize: 16,
    },
    // "On the map" toggle section — Your-map layer switches (TICKET-134).
    onMapSection: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 8,
        marginTop: 4,
    },
    onMapLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 2,
    },
});
