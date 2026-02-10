/**
 * MemberAvatars - Horizontal row of member avatar circles
 */
import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';

interface Member {
    member_id: string;
    role: 'admin' | 'member';
    profiles?: {
        display_name?: string;
        avatar_url?: string;
    };
}

interface MemberAvatarsProps {
    members: Member[];
    maxVisible?: number;
    size?: number;
    theme: {
        text: string;
        textSecondary: string;
        card: string;
        primary: string;
    };
}

export function MemberAvatars({
    members,
    maxVisible = 5,
    size = 40,
    theme,
}: MemberAvatarsProps) {
    const visibleMembers = members.slice(0, maxVisible);
    const remainingCount = members.length - maxVisible;

    const getInitials = (name?: string): string => {
        if (!name) return '?';
        return name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <View style={styles.container}>
            {visibleMembers.map((member, index) => (
                <View
                    key={member.member_id}
                    style={[
                        styles.avatarContainer,
                        {
                            width: size,
                            height: size,
                            borderRadius: size / 2,
                            marginLeft: index > 0 ? -size / 4 : 0,
                            zIndex: maxVisible - index,
                        },
                    ]}
                >
                    {member.profiles?.avatar_url ? (
                        <Image
                            source={{ uri: member.profiles.avatar_url }}
                            style={[
                                styles.avatar,
                                { width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 },
                            ]}
                        />
                    ) : (
                        <View
                            style={[
                                styles.avatarFallback,
                                {
                                    width: size - 4,
                                    height: size - 4,
                                    borderRadius: (size - 4) / 2,
                                    backgroundColor: theme.primary,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.initialsText,
                                    { fontSize: size / 3, color: 'white' },
                                ]}
                            >
                                {getInitials(member.profiles?.display_name)}
                            </Text>
                        </View>
                    )}
                    {member.role === 'admin' && (
                        <View style={[styles.adminBadge, { backgroundColor: theme.primary }]}>
                            <Text style={styles.adminBadgeText}>★</Text>
                        </View>
                    )}
                </View>
            ))}
            {remainingCount > 0 && (
                <View
                    style={[
                        styles.avatarContainer,
                        styles.moreContainer,
                        {
                            width: size,
                            height: size,
                            borderRadius: size / 2,
                            marginLeft: -size / 4,
                            backgroundColor: theme.card,
                        },
                    ]}
                >
                    <Text style={[styles.moreText, { color: theme.textSecondary }]}>
                        +{remainingCount}
                    </Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarContainer: {
        backgroundColor: 'white',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: 'white',
    },
    avatar: {
        resizeMode: 'cover',
    },
    avatarFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    initialsText: {
        fontWeight: '600',
    },
    adminBadge: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: 14,
        height: 14,
        borderRadius: 7,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: 'white',
    },
    adminBadgeText: {
        color: 'white',
        fontSize: 8,
        fontWeight: 'bold',
    },
    moreContainer: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    moreText: {
        fontSize: 12,
        fontWeight: '600',
    },
});
