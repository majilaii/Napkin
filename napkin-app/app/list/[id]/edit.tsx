/**
 * List edit screen — /list/[id]/edit
 * Modal presentation. Renders ListEditForm for rename/ranked/privacy/delete.
 */
import React from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useList } from '@/hooks/lists/useList';
import { ListEditForm } from '@/components/lists';

export default function ListEditScreen() {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    // Expo Router nested dynamic: [id] is the list id
    const { id } = useLocalSearchParams<{ id: string }>();
    const { data: result, isLoading } = useList(id);

    const list = result?.data?.list ?? null;
    const isOwner = !!user && !!list && list.owner_id === user.id;

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Top bar */}
                <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[Type.body, { color: palette.primary }]}>Cancel</Text>
                    </Pressable>
                    <Text style={[Type.titleMedium, { color: palette.text }]}>Edit list</Text>
                    <View style={{ width: 60 }} />
                </View>

                {isLoading && (
                    <View style={styles.center}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                )}

                {!isLoading && (!list || !isOwner) && (
                    <View style={styles.center}>
                        <Text style={[Type.body, { color: palette.textMuted }]}>
                            Not found or you do not own this list.
                        </Text>
                    </View>
                )}

                {!isLoading && list && isOwner && user && (
                    <ListEditForm
                        list={list}
                        userId={user.id}
                        onDone={() => router.back()}
                        onDeleted={() => {
                            // Pop back past detail to lists
                            router.replace('/lists');
                        }}
                    />
                )}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
    },
});
