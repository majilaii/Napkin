/**
 * PresenceRow — horizontal avatar row showing who is present in a live round.
 * Colored rings indicate activity state. Dimmed avatars for offline participants.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Spacing, Type } from '@/constants/theme';
import type { PresencePayload } from '@/hooks/tables/usePresence';

interface Participant {
    user_id: string;
    ready: boolean;
    profiles: {
        display_name: string;
        avatar_url: string | null;
    };
}

type Palette = {
    primary: string;
    secondary: string;
    tertiary: string;
    success: string;
    surfaceContainerHigh: string;
    textSecondary: string;
    text: string;
    [key: string]: string;
};

interface PresenceRowProps {
    participants: Participant[];
    presenceState: Record<string, PresencePayload>;
    palette: Palette;
}

const AVATAR_SIZE = 40;
const RING_SIZE = AVATAR_SIZE + 6; // 3px ring on each side

function PulsingRing({ color }: { color: string }) {
    const pulse = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 0.4,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );
        animation.start();
        return () => animation.stop();
    }, [pulse]);

    return (
        <Animated.View
            style={[
                styles.ring,
                {
                    borderColor: color,
                    opacity: pulse,
                },
            ]}
        />
    );
}

function StaticRing({ color }: { color: string }) {
    return <View style={[styles.ring, { borderColor: color }]} />;
}

export function PresenceRow({ participants, presenceState, palette }: PresenceRowProps) {
    const onlineCount = participants.filter(
        (p) => presenceState[p.user_id] || p.ready
    ).length;

    return (
        <View style={styles.container}>
            <View style={styles.avatarRow}>
                {participants.map((p) => {
                    const presence = presenceState[p.user_id];
                    const isReadyInDb = p.ready;

                    // DB ready is authoritative over presence status
                    const effectiveStatus = isReadyInDb
                        ? 'ready'
                        : presence?.status ?? null;

                    const isOnline = !!presence || isReadyInDb;

                    const initials = p.profiles.display_name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2);

                    // Ring color based on status
                    let ringColor: string | null = null;
                    let shouldPulse = false;

                    if (effectiveStatus === 'ready') {
                        ringColor = palette.primary; // terracotta solid
                    } else if (effectiveStatus === 'rating' || effectiveStatus === 'uploading') {
                        ringColor = palette.tertiary; // amber, pulsing
                        shouldPulse = true;
                    } else if (effectiveStatus === 'viewing') {
                        ringColor = palette.success; // olive green
                    }

                    return (
                        <View key={p.user_id} style={styles.avatarWrapper}>
                            <View style={{ width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' }}>
                                {ringColor && shouldPulse && <PulsingRing color={ringColor} />}
                                {ringColor && !shouldPulse && <StaticRing color={ringColor} />}
                                <View
                                    style={[
                                        styles.avatar,
                                        {
                                            backgroundColor: palette.surfaceContainerHigh,
                                            opacity: isOnline ? 1 : 0.5,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={{
                                            fontSize: 12,
                                            fontFamily: 'Manrope_700Bold',
                                            color: palette.text,
                                        }}
                                    >
                                        {initials}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    );
                })}
            </View>
            <Text style={[Type.labelSmall, { color: palette.textSecondary, marginTop: Spacing.xs }]}>
                {onlineCount} of {participants.length} here
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
    },
    avatarRow: {
        flexDirection: 'row',
        gap: Spacing.sm,
    },
    avatarWrapper: {
        alignItems: 'center',
    },
    ring: {
        position: 'absolute',
        width: RING_SIZE,
        height: RING_SIZE,
        borderRadius: RING_SIZE / 2,
        borderWidth: 3,
    },
    avatar: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
