import React from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Shadow, Spacing } from '@/constants/theme';

export interface WishlistMapListOption {
    id: string;
    title: string;
    emoji: string | null;
    entryCount: number;
    ownerLabel?: string | null;
}

interface Props {
    visible: boolean;
    onDismiss: () => void;
    palette: typeof Colors.light;
    selectedListId: string | null;
    myLists: WishlistMapListOption[];
    savedLists: WishlistMapListOption[];
    onSelect: (listId: string | null) => void;
}

function ListRow({
    option,
    selected,
    palette,
    onPress,
}: {
    option: WishlistMapListOption | null;
    selected: boolean;
    palette: typeof Colors.light;
    onPress: () => void;
}) {
    const title = option?.title ?? 'Your places';
    const count = option?.entryCount;
    const subtitle = option
        ? [
              `${count} ${count === 1 ? 'place' : 'places'}`,
              option.ownerLabel ? `by ${option.ownerLabel}` : null,
          ].filter(Boolean).join(' · ')
        : 'Wishlist and places you have been';

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                selected && { backgroundColor: palette.primaryMuted },
                pressed && { transform: [{ scale: 0.96 }], opacity: 0.82 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${title}, ${subtitle}`}
        >
            <View
                style={[
                    styles.emojiPlate,
                    { backgroundColor: selected ? palette.surfaceContainerLow : palette.surfaceContainer },
                ]}
            >
                {option?.emoji ? (
                    <Text style={styles.emoji}>{option.emoji}</Text>
                ) : (
                    <Ionicons
                        name={option ? 'list-outline' : 'heart-outline'}
                        size={18}
                        color={selected ? palette.primary : palette.textSecondary}
                    />
                )}
            </View>
            <View style={styles.copy}>
                <Text
                    style={[styles.title, { color: selected ? palette.primary : palette.text }]}
                    numberOfLines={1}
                >
                    {title}
                </Text>
                <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
                    {subtitle}
                </Text>
            </View>
            {selected ? (
                <Ionicons name="checkmark-circle" size={21} color={palette.primary} />
            ) : null}
        </Pressable>
    );
}

export function WishlistListsSheet({
    visible,
    onDismiss,
    palette,
    selectedListId,
    myLists,
    savedLists,
    onSelect,
}: Props) {
    const insets = useSafeAreaInsets();
    const select = (listId: string | null) => {
        onSelect(listId);
        onDismiss();
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
            <Pressable style={styles.backdrop} onPress={onDismiss}>
                <Pressable
                    style={[
                        styles.sheet,
                        { backgroundColor: palette.surfaceNote, paddingBottom: insets.bottom + Spacing.md },
                        Shadow.ambient,
                    ]}
                    onPress={(event) => event.stopPropagation()}
                >
                    <View style={[styles.grabber, { backgroundColor: palette.ruleWarmNib }]} />
                    <View style={styles.headerRow}>
                        <View>
                            <Text style={[styles.eyebrow, { color: palette.textMuted }]}>LISTS</Text>
                            <Text style={[styles.header, { color: palette.text }]}>Show on your map</Text>
                        </View>
                        <Pressable
                            onPress={onDismiss}
                            style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel="Close Lists"
                        >
                            <Ionicons name="close" size={19} color={palette.textSecondary} />
                        </Pressable>
                    </View>

                    <ScrollView
                        style={styles.scroll}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        <ListRow
                            option={null}
                            selected={selectedListId === null}
                            palette={palette}
                            onPress={() => select(null)}
                        />

                        {myLists.length > 0 ? (
                            <>
                                <Text style={[styles.section, { color: palette.textMuted }]}>Your Lists</Text>
                                {myLists.map((option) => (
                                    <ListRow
                                        key={option.id}
                                        option={option}
                                        selected={selectedListId === option.id}
                                        palette={palette}
                                        onPress={() => select(option.id)}
                                    />
                                ))}
                            </>
                        ) : null}

                        {savedLists.length > 0 ? (
                            <>
                                <Text style={[styles.section, { color: palette.textMuted }]}>Saved Lists</Text>
                                {savedLists.map((option) => (
                                    <ListRow
                                        key={option.id}
                                        option={option}
                                        selected={selectedListId === option.id}
                                        palette={palette}
                                        onPress={() => select(option.id)}
                                    />
                                ))}
                            </>
                        ) : null}
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(70, 45, 34, 0.24)',
    },
    sheet: {
        maxHeight: '78%',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingTop: Spacing.sm,
        paddingHorizontal: Spacing.lg,
    },
    grabber: {
        alignSelf: 'center',
        width: 44,
        height: 5,
        borderRadius: 3,
        opacity: 0.55,
        marginBottom: Spacing.md,
    },
    headerRow: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: Spacing.sm,
    },
    eyebrow: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.5,
        marginBottom: 2,
    },
    header: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 25,
        lineHeight: 29,
    },
    close: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    scroll: {
        flexGrow: 0,
    },
    scrollContent: {
        paddingBottom: Spacing.sm,
    },
    section: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginTop: Spacing.lg,
        marginBottom: Spacing.xs,
        paddingHorizontal: Spacing.xs,
    },
    row: {
        minHeight: 64,
        borderRadius: 18,
        paddingHorizontal: Spacing.sm,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    emojiPlate: {
        width: 44,
        height: 44,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emoji: {
        fontSize: 21,
        lineHeight: 27,
    },
    copy: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
        lineHeight: 19,
    },
    subtitle: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        lineHeight: 17,
        marginTop: 1,
    },
});
