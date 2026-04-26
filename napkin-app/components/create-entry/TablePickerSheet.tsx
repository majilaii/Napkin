/**
 * TablePickerSheet — bottom sheet for picking which Table to share an entry to.
 *
 * Single-select (v1). Multi-select (one entry → multiple Tables) arrives with
 * the entries.table_id schema rework — see backlog ticket.
 *
 * Shell cloned from CompanionPickerSheet (Modal + Animated.spring + PanResponder
 * drag-to-dismiss). Search filters by table name (client-side; counts are
 * small).
 *
 * Tap a row → set selection and dismiss. The "Don't share" row at the top
 * clears the selection.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    Modal,
    Animated,
    StyleSheet,
    PanResponder,
    TextInput,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';

type Palette = typeof Colors.light;

export interface TablePickerSheetTable {
    id: string;
    name: string;
}

interface Props {
    visible: boolean;
    onClose: () => void;
    tables: TablePickerSheetTable[];
    selectedId: string | null;
    onSelect: (tableId: string | null) => void;
    palette: Palette;
}

const DRAG_DISMISS_THRESHOLD = 80;
const SHEET_HEIGHT = 460;

export function TablePickerSheet({
    visible,
    onClose,
    tables,
    selectedId,
    onSelect,
    palette,
}: Props) {
    const insets = useSafeAreaInsets();
    const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
    const dragY = useRef(new Animated.Value(0)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    const [query, setQuery] = useState('');

    useEffect(() => {
        if (!visible) setQuery('');
    }, [visible]);

    useEffect(() => {
        if (visible) {
            dragY.setValue(0);
            Animated.parallel([
                Animated.spring(translateY, {
                    toValue: 0,
                    useNativeDriver: true,
                    damping: 22,
                    stiffness: 220,
                }),
                Animated.timing(backdropOpacity, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.spring(translateY, {
                    toValue: SHEET_HEIGHT,
                    useNativeDriver: true,
                    damping: 30,
                    stiffness: 300,
                }),
                Animated.timing(backdropOpacity, {
                    toValue: 0,
                    duration: 160,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible, translateY, dragY, backdropOpacity]);

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 6,
            onPanResponderMove: (_, gs) => {
                if (gs.dy > 0) dragY.setValue(gs.dy);
            },
            onPanResponderRelease: (_, gs) => {
                if (gs.dy > DRAG_DISMISS_THRESHOLD || gs.vy > 0.8) {
                    onClose();
                } else {
                    Animated.spring(dragY, {
                        toValue: 0,
                        useNativeDriver: true,
                        damping: 22,
                        stiffness: 200,
                    }).start();
                }
            },
        })
    ).current;

    const sheetTranslate = Animated.add(translateY, dragY);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return tables;
        return tables.filter(t => t.name.toLowerCase().includes(q));
    }, [query, tables]);

    const handlePick = (id: string | null) => {
        onSelect(id);
        onClose();
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
                <Pressable
                    style={[StyleSheet.absoluteFill, styles.backdrop]}
                    onPress={onClose}
                    accessibilityLabel="Close table picker"
                />
            </Animated.View>

            <Animated.View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        paddingBottom: insets.bottom + Spacing.md,
                        transform: [{ translateY: sheetTranslate }],
                    },
                ]}
            >
                <View {...panResponder.panHandlers} style={styles.handleArea}>
                    <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />
                </View>

                <View style={styles.titleRow}>
                    <Text style={[styles.sheetTitle, { color: palette.text }]}>
                        Post to a table?
                    </Text>
                    <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Done">
                        <Text style={[styles.doneLabel, { color: palette.primary }]}>Done</Text>
                    </Pressable>
                </View>

                {tables.length > 6 ? (
                    <View
                        style={[
                            styles.searchRow,
                            { backgroundColor: palette.surfaceContainerHigh },
                        ]}
                    >
                        <Ionicons name="search-outline" size={16} color={palette.textMuted} />
                        <TextInput
                            style={[styles.searchInput, { color: palette.text }]}
                            placeholder="Search your tables"
                            placeholderTextColor={palette.textMuted}
                            value={query}
                            onChangeText={setQuery}
                            autoCorrect={false}
                            autoCapitalize="none"
                            returnKeyType="search"
                        />
                        {query.length > 0 ? (
                            <Pressable onPress={() => setQuery('')} hitSlop={6}>
                                <Ionicons name="close-circle" size={16} color={palette.textMuted} />
                            </Pressable>
                        ) : null}
                    </View>
                ) : null}

                <ScrollView
                    style={{ flex: 1 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* "Don't share" row — clears selection (solo / private) */}
                    <TableRow
                        label="Don't share — keep it private"
                        italic
                        selected={selectedId === null}
                        onPress={() => handlePick(null)}
                        palette={palette}
                    />

                    {filtered.length === 0 && query.trim() ? (
                        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                            No tables match &ldquo;{query.trim()}&rdquo;
                        </Text>
                    ) : (
                        filtered.map(table => (
                            <TableRow
                                key={table.id}
                                label={table.name}
                                selected={selectedId === table.id}
                                onPress={() => handlePick(table.id)}
                                palette={palette}
                            />
                        ))
                    )}

                    {tables.length === 0 ? (
                        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                            You&rsquo;re not in any tables yet.
                        </Text>
                    ) : null}
                </ScrollView>
            </Animated.View>
        </Modal>
    );
}

interface RowProps {
    label: string;
    italic?: boolean;
    selected: boolean;
    onPress: () => void;
    palette: Palette;
}

function TableRow({ label, italic, selected, onPress, palette }: RowProps) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                {
                    backgroundColor: selected
                        ? palette.primaryMuted
                        : pressed
                        ? palette.surfaceContainerHigh
                        : 'transparent',
                },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
        >
            <Text
                style={[
                    styles.rowLabel,
                    {
                        color: selected ? palette.primary : palette.text,
                        fontFamily: italic
                            ? 'Newsreader_400Regular_Italic'
                            : 'Manrope_500Medium',
                        fontStyle: italic ? 'italic' : 'normal',
                    },
                ]}
                numberOfLines={1}
            >
                {label}
            </Text>
            {selected ? (
                <Ionicons name="checkmark" size={18} color={palette.primary} />
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        backgroundColor: 'rgba(28, 28, 25, 0.4)',
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 16,
        minHeight: SHEET_HEIGHT,
        maxHeight: '80%',
    },
    handleArea: {
        alignItems: 'center',
        paddingVertical: Spacing.md,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm + 4,
    },
    sheetTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        letterSpacing: -0.3,
    },
    doneLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginHorizontal: Spacing.lg,
        marginBottom: Spacing.sm,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
        borderRadius: Radius.md,
    },
    searchInput: {
        flex: 1,
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        padding: 0,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        gap: Spacing.md,
    },
    rowLabel: {
        flex: 1,
        fontSize: 15,
    },
    emptyText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        textAlign: 'center',
        paddingTop: Spacing.xl,
        paddingHorizontal: Spacing.lg,
    },
});
