import React from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/feed/Avatar';
import { Colors, IconSize, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import type { PlacesScope } from '@/hooks/search/placesScreenState';
import type { TableMember } from '@/hooks/tables/useTableMembers';
import type { TableMembership } from '@/hooks/tables/useTables';

type Palette = typeof Colors.light;

// A member of many tables must still be able to reach the last row — cap the
// row list to a fraction of the window instead of letting the sheet grow
// past the screen.
const ROWS_MAX_HEIGHT_RATIO = 0.6;

export interface WhoChipPresentation {
    label: string;
    icon: 'person-outline' | 'people-outline' | null;
    faces: TableMember[];
    active: boolean;
}

export function whoChipPresentation(
    scope: PlacesScope,
    tableName: string | null,
    members: readonly TableMember[] | undefined,
): WhoChipPresentation {
    if (scope.kind === 'friends') {
        return { label: 'friends', icon: 'people-outline', faces: [], active: true };
    }
    if (scope.kind === 'table') {
        return {
            label: tableName?.trim() || 'the table',
            icon: null,
            faces: members?.slice(0, 2) ?? [],
            active: true,
        };
    }
    return { label: 'you', icon: 'person-outline', faces: [], active: false };
}

export function WhoChip({
    scope,
    tableName,
    members,
    palette,
    onPress,
}: {
    scope: PlacesScope;
    tableName: string | null;
    members?: readonly TableMember[];
    palette: Palette;
    onPress?: () => void;
}) {
    const presentation = whoChipPresentation(scope, tableName, members);
    const content = (
        <>
            {presentation.faces.length > 0 ? (
                <View style={styles.chipFaces}>
                    {presentation.faces.map((member, index) => (
                        <View
                            key={member.member_id}
                            testID="who-chip-face"
                            style={index > 0 ? styles.chipFaceOverlap : null}
                        >
                            <Avatar
                                name={member.profiles?.display_name ?? 'member'}
                                url={member.profiles?.avatar_url ?? null}
                                size={IconSize.sm + Spacing.xs / 2}
                                palette={palette}
                            />
                        </View>
                    ))}
                </View>
            ) : presentation.icon ? (
                <Ionicons
                    name={presentation.icon}
                    size={IconSize.sm + Spacing.xs / 2}
                    color={presentation.active ? palette.textInverse : palette.textSecondary}
                />
            ) : null}
            <Text
                numberOfLines={1}
                style={[
                    styles.chipLabel,
                    { color: presentation.active ? palette.textInverse : palette.textSecondary },
                ]}
            >
                {presentation.label}
            </Text>
            {onPress ? (
                <Ionicons
                    name="chevron-down-outline"
                    size={IconSize.sm}
                    color={presentation.active ? palette.textInverse : palette.textFaint}
                />
            ) : null}
        </>
    );

    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            style={({ pressed }) => [
                styles.chip,
                Shadow.ambient,
                {
                    backgroundColor: presentation.active ? palette.primary : palette.scrimFrost,
                    opacity: pressed ? 0.72 : 1,
                },
            ]}
            accessibilityRole={onPress ? 'button' : undefined}
            accessibilityState={{ selected: presentation.active, disabled: !onPress }}
            accessibilityLabel={`who, ${presentation.label}`}
        >
            {content}
        </Pressable>
    );
}

function scopeMatches(a: PlacesScope, b: PlacesScope): boolean {
    if (a.kind !== b.kind) return false;
    return a.kind !== 'table' || (b.kind === 'table' && a.tableId === b.tableId);
}

function PickerRow({
    label,
    meta,
    selected,
    palette,
    avatar,
    icon,
    onPress,
}: {
    label: string;
    meta?: string | null;
    selected: boolean;
    palette: Palette;
    avatar?: { name: string; url: string | null };
    icon?: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            accessibilityHint={meta ?? undefined}
        >
            {avatar ? (
                <Avatar
                    name={avatar.name}
                    url={avatar.url}
                    size={Spacing.xl + Spacing.xs}
                    palette={palette}
                />
            ) : (
                <View style={[styles.glyph, { backgroundColor: palette.surfaceJournal }] }>
                    <Ionicons
                        name={icon ?? 'people-outline'}
                        size={IconSize.md}
                        color={palette.textSecondary}
                    />
                </View>
            )}
            <View style={styles.rowCopy}>
                <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                    {label}
                </Text>
                {meta ? (
                    <Text style={[Type.feedMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {meta}
                    </Text>
                ) : null}
            </View>
            {selected ? (
                <Ionicons
                    testID={`scope-check-${label}`}
                    name="checkmark-outline"
                    size={IconSize.lg}
                    color={palette.primary}
                />
            ) : null}
        </Pressable>
    );
}

export function ScopePickerSheet({
    visible,
    scope,
    palette,
    profile,
    pinnedCount,
    beenCount,
    followingCount,
    tables,
    onSelect,
    onDismiss,
}: {
    visible: boolean;
    scope: PlacesScope;
    palette: Palette;
    profile: { displayName: string; avatarUrl: string | null };
    pinnedCount?: number;
    beenCount?: number;
    followingCount?: number;
    tables: readonly TableMembership[];
    onSelect: (scope: PlacesScope) => void;
    onDismiss: () => void;
}) {
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const youMeta = [
        pinnedCount == null ? null : `${pinnedCount} pinned`,
        beenCount == null ? null : `${beenCount} been`,
    ].filter((part): part is string => !!part).join(' · ');
    const select = (next: PlacesScope) => {
        onSelect(next);
        onDismiss();
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
            <View style={styles.modalRoot}>
                <Pressable
                    style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.overlay }]}
                    onPress={onDismiss}
                    accessibilityRole="button"
                    accessibilityLabel="close who picker"
                />
                <View
                    style={[
                        styles.sheet,
                        Shadow.nav,
                        {
                            backgroundColor: palette.background,
                            paddingBottom: Math.max(insets.bottom, Spacing.lg),
                        },
                    ]}
                >
                    <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />
                    <Text style={[styles.kicker, { color: palette.primary }]}>WHO</Text>
                    <ScrollView
                        testID="scope-picker-rows"
                        style={{ maxHeight: windowHeight * ROWS_MAX_HEIGHT_RATIO }}
                        showsVerticalScrollIndicator={false}
                    >
                        <PickerRow
                            label="you"
                            meta={youMeta || null}
                            selected={scope.kind === 'you'}
                            palette={palette}
                            avatar={{ name: profile.displayName, url: profile.avatarUrl }}
                            onPress={() => select({ kind: 'you' })}
                        />
                        <PickerRow
                            label="friends"
                            meta={followingCount == null ? null : `${followingCount} you follow`}
                            selected={scope.kind === 'friends'}
                            palette={palette}
                            icon="people-outline"
                            onPress={() => select({ kind: 'friends' })}
                        />
                        {tables.map((membership) => {
                            const next: PlacesScope = {
                                kind: 'table',
                                tableId: membership.tables.id,
                            };
                            const memberCount = membership.tables.member_count;
                            return (
                                <PickerRow
                                    key={membership.tables.id}
                                    label={membership.tables.name}
                                    meta={memberCount == null
                                        ? null
                                        : `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`}
                                    selected={scopeMatches(scope, next)}
                                    palette={palette}
                                    icon="people-outline"
                                    onPress={() => select(next)}
                                />
                            );
                        })}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalRoot: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    sheet: {
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingTop: Spacing.sm,
    },
    handle: {
        width: Spacing.xl + Spacing.xs,
        height: Spacing.xs,
        borderRadius: Radius.full,
        alignSelf: 'center',
        marginBottom: Spacing.sm - Spacing.xs / 2,
    },
    kicker: {
        ...Type.sectionKicker,
        paddingHorizontal: Spacing.pageGutter,
        paddingTop: Spacing.sm + Spacing.xs / 2,
        paddingBottom: Spacing.sm - Spacing.xs / 2,
    },
    row: {
        minHeight: Spacing.xxl + Spacing.sm + Spacing.xs,
        paddingHorizontal: Spacing.pageGutter,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + Spacing.xs,
    },
    pressed: {
        opacity: 0.72,
    },
    glyph: {
        width: Spacing.xl + Spacing.xs,
        height: Spacing.xl + Spacing.xs,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowCopy: {
        flex: 1,
        minWidth: 0,
        gap: Spacing.xs / 2,
    },
    rowName: {
        ...Type.feedNoteRestaurant,
    },
    chip: {
        minHeight: Spacing.hitTarget - Spacing.xs,
        maxWidth: Spacing.xxl * 4,
        borderRadius: Radius.full,
        paddingHorizontal: Spacing.sm + Spacing.xs + Spacing.xs / 2,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm - Spacing.xs / 2,
    },
    chipLabel: {
        ...Type.feedLedger,
        fontFamily: 'Manrope_600SemiBold',
        flexShrink: 1,
    },
    chipFaces: {
        flexDirection: 'row',
    },
    chipFaceOverlap: {
        marginLeft: -(Spacing.sm - Spacing.xs / 2),
    },
});
