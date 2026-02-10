/**
 * TableHeader - Displays table info with avatar, name, and members
 */
import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { MemberAvatars } from './MemberAvatars';
import type { Table } from '@/hooks/tables/useTables';

interface Member {
    member_id: string;
    role: 'admin' | 'member';
    joined_at: string;
    profiles?: {
        display_name?: string;
        avatar_url?: string;
    };
}

interface TableHeaderProps {
    table: Table;
    members: Member[];
    theme: {
        text: string;
        textSecondary: string;
        card: string;
        primary: string;
        background: string;
    };
}

export function TableHeader({ table, members, theme }: TableHeaderProps) {
    const memberCount = members.length;
    const createdDate = new Date(table.created_at);
    const formattedDate = createdDate.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
    });

    const getInitials = (name: string): string => {
        return name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <View style={styles.container}>
            {/* Table Avatar */}
            <View style={[styles.tableAvatarContainer, { backgroundColor: theme.primary }]}>
                {table.avatar_url ? (
                    <Image source={{ uri: table.avatar_url }} style={styles.tableAvatar} />
                ) : (
                    <Text style={styles.tableAvatarText}>{getInitials(table.name)}</Text>
                )}
            </View>

            {/* Table Info */}
            <Text style={[styles.tableName, { color: theme.text }]}>{table.name}</Text>
            <Text style={[styles.tableMeta, { color: theme.textSecondary }]}>
                {memberCount} {memberCount === 1 ? 'member' : 'members'} • Est. {formattedDate}
            </Text>

            {/* Member Avatars */}
            <View style={styles.membersContainer}>
                <MemberAvatars members={members} theme={theme} maxVisible={6} size={44} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        paddingVertical: 20,
    },
    tableAvatarContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 12,
    },
    tableAvatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
    },
    tableAvatarText: {
        color: 'white',
        fontSize: 28,
        fontWeight: 'bold',
    },
    tableName: {
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 4,
    },
    tableMeta: {
        fontSize: 14,
        marginBottom: 16,
    },
    membersContainer: {
        paddingHorizontal: 20,
    },
});
