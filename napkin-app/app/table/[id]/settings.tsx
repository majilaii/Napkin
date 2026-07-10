/**
 * Table Settings — /table/[id]/settings
 *
 * Sections:
 *  1. Header: Table name (italic serif) + member count
 *  2. "Add member" row — owner only. Opens AddMemberSheet.
 *  3. Members list — avatar + name + Owner chip. Tapping routes to their profile.
 *  4. "Leave Table" footer — non-owner members only.
 *
 * TICKET-029
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    ScrollView,
    Pressable,
    ActivityIndicator,
    StyleSheet,
    Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { useTables } from '@/hooks/tables/useTables';
import { useLeaveTable } from '@/hooks/tables/useLeaveTable';
import { useDeleteTable } from '@/hooks/tables/useDeleteTable';
import { TableMemberRow, AddMemberSheet } from '@/components/tables';

export default function TableSettingsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { id: tableId } = useLocalSearchParams<{ id: string }>();
    const { user } = useAuth();

    const { data: tables } = useTables(user?.id);
    const { data: members, isLoading: membersLoading } = useTableMembers(tableId);
    const leaveTable = useLeaveTable(user?.id);
    const deleteTable = useDeleteTable(user?.id);

    const [showAddMember, setShowAddMember] = useState(false);

    // Resolve the table object from the tables list
    const tableMembership = tables?.find((t) => t.tables?.id === tableId);
    const table = tableMembership?.tables;
    const isOwner = table?.owner_id === user?.id;
    const callerRole = tableMembership?.role;
    const isNonOwnerMember = callerRole === 'member';

    const tableName = table?.name ?? 'Table';

    const handleLeave = () => {
        Alert.alert(
            `Leave ${tableName}?`,
            "You'll be removed from this table's feed and wishlist.",
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Leave',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await leaveTable.mutateAsync({ tableId: tableId! });
                            router.replace('/(tabs)/tables');
                        } catch (err: any) {
                            Alert.alert('Could not leave', err?.message ?? 'Please try again.');
                        }
                    },
                },
            ]
        );
    };

    const memberCount = members?.length ?? 0;

    const handleDelete = () => {
        const body =
            memberCount <= 1
                ? 'Your logged meals stay in your journal.'
                : `This removes it for all ${memberCount} members. Everyone's logged meals stay in their journals.`;
        Alert.alert(
            `Delete ${tableName}?`,
            body,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteTable.mutateAsync({ tableId: tableId! });
                            router.replace('/(tabs)/tables');
                        } catch (err: any) {
                            Alert.alert('Could not delete', err?.message ?? 'Please try again.');
                        }
                    },
                },
            ]
        );
    };

    return (
        <View style={[styles.screen, { backgroundColor: palette.background }]}>
            {/* Nav header */}
            <View
                style={[
                    styles.navBar,
                    { paddingTop: insets.top + Spacing.sm },
                ]}
            >
                <Pressable
                    onPress={() => router.back()}
                    style={styles.backButton}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Ionicons name="chevron-back-outline" size={22} color={palette.text} />
                </Pressable>
                <Text style={[styles.navTitle, { color: palette.text }]}>Settings</Text>
                <View style={styles.navRight} />
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
                showsVerticalScrollIndicator={false}
            >
                {/* Table name hero */}
                <View style={styles.hero}>
                    <Text style={[styles.kicker, { color: palette.textMuted }]}>TABLE</Text>
                    <Text style={[styles.tableName, { color: palette.text }]} numberOfLines={2}>
                        {tableName}
                    </Text>
                    <Text style={[styles.memberCount, { color: palette.textMuted }]}>
                        {members?.length ?? 0} {(members?.length ?? 0) === 1 ? 'member' : 'members'}
                    </Text>
                </View>

                {/* Warm divider */}
                <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />

                {/* Members section */}
                <View style={styles.section}>
                    <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                        MEMBERS
                    </Text>

                    {/* Add member row — owner only */}
                    {isOwner && (
                        <Pressable
                            onPress={() => setShowAddMember(true)}
                            style={({ pressed }) => [
                                styles.addRow,
                                { opacity: pressed ? 0.7 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="Add member"
                        >
                            <View
                                style={[
                                    styles.addIcon,
                                    { backgroundColor: palette.primaryMuted },
                                ]}
                            >
                                <Ionicons name="person-add-outline" size={18} color={palette.primary} />
                            </View>
                            <Text style={[styles.addLabel, { color: palette.primary }]}>
                                Add member
                            </Text>
                        </Pressable>
                    )}

                    {membersLoading ? (
                        <ActivityIndicator
                            color={palette.primary}
                            style={{ marginVertical: Spacing.xl }}
                        />
                    ) : (
                        (members ?? []).map((member) => (
                            <TableMemberRow
                                key={member.member_id}
                                userId={member.member_id}
                                displayName={member.profiles?.display_name ?? 'Unknown'}
                                avatarUrl={member.profiles?.avatar_url ?? null}
                                isOwner={member.role === 'admin'}
                                palette={palette}
                                onPress={() =>
                                    router.push({
                                        pathname: '/member/[userId]',
                                        params: { userId: member.member_id },
                                    })
                                }
                            />
                        ))
                    )}
                </View>

                {/* Warm divider */}
                {isNonOwnerMember && (
                    <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />
                )}

                {/* Leave Table — non-owner members only */}
                {isNonOwnerMember && (
                    <Pressable
                        onPress={handleLeave}
                        style={({ pressed }) => [
                            styles.leaveRow,
                            { opacity: pressed ? 0.7 : 1 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Leave ${tableName}`}
                    >
                        <Ionicons name="exit-outline" size={20} color={palette.error} />
                        <Text style={[styles.leaveLabel, { color: palette.error }]}>
                            Leave table
                        </Text>
                    </Pressable>
                )}

                {/* Delete Table — owner only */}
                {isOwner && (
                    <>
                        <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />
                        <Pressable
                            onPress={handleDelete}
                            style={({ pressed }) => [
                                styles.leaveRow,
                                { opacity: pressed ? 0.7 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${tableName}`}
                        >
                            <Ionicons name="trash-outline" size={20} color={palette.error} />
                            <Text style={[styles.leaveLabel, { color: palette.error }]}>
                                Delete table
                            </Text>
                        </Pressable>
                    </>
                )}
            </ScrollView>

            {/* Add Member Sheet */}
            {isOwner && tableId && (
                <AddMemberSheet
                    visible={showAddMember}
                    onClose={() => setShowAddMember(false)}
                    tableId={tableId}
                    palette={palette}
                    userId={user?.id}
                    tableName={tableName}
                />
            )}
        </View>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    screen: {
        flex: 1,
    },
    navBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
    backButton: {
        width: 32,
    },
    navTitle: {
        flex: 1,
        textAlign: 'center',
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 15,
        letterSpacing: 0.3,
    },
    navRight: {
        width: 32,
    },
    hero: {
        paddingHorizontal: 22,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    tableName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 28,
        lineHeight: 32,
        letterSpacing: -0.3,
    },
    memberCount: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        marginTop: 4,
        letterSpacing: 0.2,
    },
    divider: {
        height: 1,
        marginHorizontal: 22,
        marginVertical: Spacing.sm,
    },
    section: {
        paddingTop: Spacing.sm,
    },
    sectionLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        paddingHorizontal: 22,
        paddingVertical: Spacing.sm,
    },
    addRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: 12,
        gap: Spacing.md,
    },
    addIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    addLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 15,
    },
    leaveRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 22,
        paddingVertical: Spacing.lg,
        gap: Spacing.sm,
    },
    leaveLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 15,
    },
});
