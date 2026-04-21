/**
 * PinToBoardSheet — bottom-sheet picker for pinning a restaurant to
 * one or more boards: your personal wishlist, and/or any of your
 * tables' shared wishlists. Canvas WF8.
 *
 * Table wishlists are an emergent algorithmic merge (doctrine), so
 * "pinning to a table" is modeled as pinning to your personal wishlist
 * with a table-scoped hint. The sheet accepts a list of tables purely
 * for presentation and hands selection back via onConfirm.
 */

import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    Modal,
    Image,
    ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Spacing } from '@/constants/theme';
import { Avatar } from '@/components/feed/Avatar';

type Palette = typeof Colors.light;

export interface PinBoardTable {
    id: string;
    name: string;
    memberCount: number;
    pinCount?: number;
    memberNames: string[];
}

interface PinToBoardSheetProps {
    visible: boolean;
    onClose: () => void;
    restaurant: {
        name: string;
        subLabel?: string;
        photoUrl?: string | null;
    };
    tables: PinBoardTable[];
    onConfirm: (selectedTableIds: string[], includePersonal: boolean) => void;
    palette: Palette;
}

export function PinToBoardSheet({
    visible,
    onClose,
    restaurant,
    tables,
    onConfirm,
    palette,
}: PinToBoardSheetProps) {
    const [personal, setPersonal] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const sharedTables = useMemo(
        () => tables,
        [tables],
    );

    const toggleTable = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const total = (personal ? 1 : 0) + selected.size;
    const ctaLabel =
        total === 0
            ? 'CHOOSE A BOARD'
            : `PIN TO ${total} BOARD${total === 1 ? '' : 'S'}`;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable
                    style={[styles.sheet, { backgroundColor: palette.background }]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View
                        style={[
                            styles.handle,
                            { backgroundColor: palette.outlineVariant },
                        ]}
                    />

                    {/* Context — the restaurant */}
                    <View style={styles.context}>
                        <View
                            style={[
                                styles.photo,
                                { backgroundColor: palette.primaryMuted },
                            ]}
                        >
                            {restaurant.photoUrl ? (
                                <Image
                                    source={{ uri: restaurant.photoUrl }}
                                    style={StyleSheet.absoluteFill}
                                    resizeMode="cover"
                                />
                            ) : (
                                <Text
                                    style={[
                                        styles.photoInitial,
                                        { color: palette.primary },
                                    ]}
                                >
                                    {restaurant.name[0]?.toUpperCase() ?? '?'}
                                </Text>
                            )}
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text
                                style={[styles.kicker, { color: palette.textMuted }]}
                            >
                                PIN TO
                            </Text>
                            <Text
                                style={[styles.restaurantName, { color: palette.text }]}
                                numberOfLines={1}
                            >
                                {restaurant.name}
                            </Text>
                            {restaurant.subLabel ? (
                                <Text
                                    style={[
                                        styles.restaurantSub,
                                        { color: palette.textMuted },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {restaurant.subLabel}
                                </Text>
                            ) : null}
                        </View>
                    </View>

                    <View
                        style={[
                            styles.divider,
                            { backgroundColor: palette.outlineVariant },
                        ]}
                    />

                    <ScrollView style={{ maxHeight: 420 }}>
                        <Text style={[styles.section, { color: palette.textMuted }]}>
                            PRIVATE
                        </Text>
                        <Row
                            palette={palette}
                            checked={personal}
                            onToggle={() => setPersonal((v) => !v)}
                            title="Your wishlist"
                            sub="Only you"
                        />

                        {sharedTables.length > 0 ? (
                            <>
                                <Text
                                    style={[styles.section, { color: palette.textMuted }]}
                                >
                                    SHARED
                                </Text>
                                {sharedTables.map((t) => (
                                    <Row
                                        key={t.id}
                                        palette={palette}
                                        checked={selected.has(t.id)}
                                        onToggle={() => toggleTable(t.id)}
                                        title={t.name}
                                        titleSerif
                                        sub={`${t.memberCount} members${
                                            t.pinCount != null
                                                ? ` \u00B7 ${t.pinCount} shared pins`
                                                : ''
                                        }`}
                                        avatars={t.memberNames}
                                    />
                                ))}
                            </>
                        ) : null}
                    </ScrollView>

                    <View style={styles.ctaRow}>
                        <Pressable
                            disabled={total === 0}
                            onPress={() => {
                                onConfirm(Array.from(selected), personal);
                                setSelected(new Set());
                                setPersonal(true);
                                onClose();
                            }}
                            style={({ pressed }) => [
                                styles.cta,
                                {
                                    backgroundColor:
                                        total === 0
                                            ? palette.surfaceJournalHi
                                            : palette.primary,
                                    opacity: pressed ? 0.88 : 1,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.ctaText,
                                    {
                                        color:
                                            total === 0
                                                ? palette.textMuted
                                                : palette.background,
                                    },
                                ]}
                            >
                                {ctaLabel}
                            </Text>
                        </Pressable>
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

function Row({
    palette,
    checked,
    onToggle,
    title,
    titleSerif,
    sub,
    avatars,
}: {
    palette: Palette;
    checked: boolean;
    onToggle: () => void;
    title: string;
    titleSerif?: boolean;
    sub: string;
    avatars?: string[];
}) {
    return (
        <Pressable onPress={onToggle} style={styles.row}>
            <View
                style={[
                    styles.check,
                    {
                        backgroundColor: checked ? palette.primary : 'transparent',
                        borderColor: checked ? palette.primary : palette.ruleInkSoft,
                    },
                ]}
            >
                {checked ? (
                    <Ionicons name="checkmark" size={14} color={palette.background} />
                ) : null}
            </View>
            {avatars && avatars.length > 0 ? (
                <View style={styles.avatarStack}>
                    {avatars.slice(0, 3).map((n, i) => (
                        <View
                            key={i}
                            style={[
                                styles.avatarCell,
                                {
                                    marginLeft: i === 0 ? 0 : -7,
                                    borderColor: palette.background,
                                    zIndex: 3 - i,
                                },
                            ]}
                        >
                            <Avatar name={n} url={null} size={20} palette={palette} />
                        </View>
                    ))}
                </View>
            ) : null}
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                    numberOfLines={1}
                    style={[
                        titleSerif ? styles.titleSerif : styles.title,
                        { color: palette.text },
                    ]}
                >
                    {title}
                </Text>
                <Text style={[styles.sub, { color: palette.textMuted }]} numberOfLines={1}>
                    {sub}
                </Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(28,28,25,0.5)',
        justifyContent: 'flex-end',
    },
    sheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: 12,
        paddingBottom: 28,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 99,
        alignSelf: 'center',
        marginBottom: 16,
    },
    context: {
        paddingHorizontal: 22,
        paddingBottom: 16,
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
    },
    photo: {
        width: 52,
        height: 52,
        borderRadius: 6,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoInitial: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 26,
        opacity: 0.35,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
        marginBottom: 2,
    },
    restaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        letterSpacing: -0.2,
    },
    restaurantSub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
    },
    divider: {
        height: 1,
        marginHorizontal: 22,
    },
    section: {
        paddingHorizontal: 22,
        paddingTop: 14,
        paddingBottom: 8,
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
    },
    row: {
        paddingHorizontal: 22,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    check: {
        width: 22,
        height: 22,
        borderRadius: 5,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarStack: {
        flexDirection: 'row',
        width: 42,
        height: 22,
    },
    avatarCell: {
        borderWidth: 2,
        borderRadius: 12,
        overflow: 'hidden',
    },
    title: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 14,
    },
    titleSerif: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        letterSpacing: -0.2,
    },
    sub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 2,
    },
    ctaRow: {
        paddingHorizontal: 22,
        paddingTop: 14,
    },
    cta: {
        paddingVertical: 13,
        borderRadius: 999,
        alignItems: 'center',
    },
    ctaText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 0.8,
    },
});
