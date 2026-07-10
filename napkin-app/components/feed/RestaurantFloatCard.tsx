/**
 * RestaurantFloatCard — TICKET-060 H3/R4/L4.
 *
 * "3 of you saved Kono this week — plan it?"
 * Emergent float card. Count + member avatars. Dismissible (saver-set keyed R4).
 * "plan it?" CTA routes to restaurant page (L4 — TICKET-061 seam).
 *
 * Only shown to Table members; privacy bound enforced server-side (fn_compute_table_float).
 * Shows count AND avatars of the members who saved it (H3 resolution).
 *
 * Heirloom Journal: lowercase, italic restaurant name, terracotta CTA, no emoji in chrome.
 */
import React, { useCallback } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDismissFloat } from '@/hooks/wishlist/useDismissFloat';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FloatMember {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
}

export interface RestaurantFloatCardProps {
    floatId: string;
    tableId: string;
    restaurant: {
        id: string;
        name: string | null;
        city: string | null;
        cuisine: string | null;
    };
    distinctCount: number;
    members: FloatMember[];
}

type Palette = typeof Colors.light;

// ── Component ─────────────────────────────────────────────────────────────────

export function RestaurantFloatCard({
    floatId,
    tableId,
    restaurant,
    distinctCount,
    members,
}: RestaurantFloatCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();
    const dismissFloat = useDismissFloat();

    const handlePlanIt = useCallback(() => {
        // L4: route to restaurant page — TICKET-061 will add scheduling UI
        if (restaurant.id) {
            router.push(`/restaurant/${restaurant.id}`);
        }
    }, [router, restaurant.id]);

    const handleDismiss = useCallback(() => {
        dismissFloat.mutate({ float_id: floatId, table_id: tableId });
    }, [dismissFloat, floatId, tableId]);

    // Build the member names summary
    const visibleMembers = members.slice(0, 3);
    const spotsWord = distinctCount === 1 ? 'person saved' : 'of you saved';
    const headerText = `${distinctCount} ${spotsWord} `;

    return (
        <View
            style={[
                styles.card,
                { backgroundColor: palette.card },
                Shadow.ambient,
            ]}
        >
            {/* Header */}
            <View style={styles.headerRow}>
                {/* Member avatar stack */}
                <View style={styles.avatarStack}>
                    {visibleMembers.slice(0, 3).map((m, i) => (
                        m.avatar_url ? (
                            <Image
                                key={m.user_id}
                                source={{ uri: m.avatar_url }}
                                style={[
                                    styles.stackAvatar,
                                    { left: i * 16 },
                                ]}
                                accessibilityIgnoresInvertColors
                            />
                        ) : (
                            <View
                                key={m.user_id}
                                style={[
                                    styles.stackAvatar,
                                    { left: i * 16, backgroundColor: palette.surfaceContainerHigh },
                                ]}
                            />
                        )
                    ))}
                </View>
                <View style={[styles.headerText, { marginLeft: visibleMembers.length * 16 + 8 }]}>
                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                        {headerText}
                        <Text style={[Type.headlineItalic, { fontSize: 13, color: palette.text }]}>
                            {restaurant.name ?? 'a restaurant'}
                        </Text>
                    </Text>
                </View>

                {/* Dismiss */}
                <Pressable
                    onPress={handleDismiss}
                    hitSlop={12}
                    accessibilityLabel="Dismiss"
                    style={styles.dismissButton}
                >
                    <Text style={[Type.caption, { color: palette.textMuted }]}>dismiss</Text>
                </Pressable>
            </View>

            {/* City line */}
            {(restaurant.city || restaurant.cuisine) ? (
                <Text style={[Type.bodySmall, { color: palette.textMuted, marginBottom: Spacing.sm }]}>
                    {[restaurant.city, restaurant.cuisine].filter(Boolean).join(' · ')}
                </Text>
            ) : null}

            {/* "plan it?" CTA — terracotta, TICKET-061 seam */}
            <Pressable
                onPress={handlePlanIt}
                style={({ pressed }) => [
                    styles.planButton,
                    {
                        backgroundColor: palette.primary,
                        opacity: pressed ? 0.85 : 1,
                    },
                ]}
                accessibilityLabel="plan it"
            >
                <Text style={[Type.label, { color: palette.textInverse }]}>
                    plan it?
                </Text>
            </Pressable>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.md,
        padding: Spacing.md,
        marginBottom: Spacing.sm,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: Spacing.xs,
    },
    avatarStack: {
        position: 'relative',
        width: 16 * 3 + 8,
        height: 28,
    },
    stackAvatar: {
        position: 'absolute',
        width: 24,
        height: 24,
        borderRadius: 12,
        top: 2,
    },
    headerText: {
        flex: 1,
    },
    dismissButton: {
        padding: Spacing.xs,
        marginLeft: Spacing.sm,
    },
    planButton: {
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.md,
        borderRadius: Radius.sm,
        alignSelf: 'flex-start',
        minHeight: 36,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Spacing.xs,
    },
});
