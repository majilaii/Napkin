import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function RestaurantLayout() {
    const router = useRouter();

    return (
        <Stack>
            <Stack.Screen
                name="search"
                options={{
                    title: 'Find a Restaurant',
                    headerShown: true,
                    headerLeft: () => (
                        <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 8 }}>
                            <Ionicons name="close" size={24} color="#007AFF" />
                        </TouchableOpacity>
                    ),
                }}
            />
            <Stack.Screen
                name="[id]"
                options={{
                    title: 'Restaurant',
                    headerShown: true,
                    headerBackTitle: 'Search',
                }}
            />
        </Stack>
    );
}
