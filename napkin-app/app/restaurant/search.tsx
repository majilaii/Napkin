import React, { useState } from 'react';
import { StyleSheet, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRestaurantSearch, SearchResult } from '@/hooks/places/useRestaurantSearch';
import { RestaurantSearch } from '@/components/restaurant';

export default function RestaurantSearchScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const router = useRouter();

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const { data: searchResults = [], isLoading: isSearching } = useRestaurantSearch(searchQuery);

    const handleSelectRestaurant = (restaurant: SearchResult) => {
        // Navigate to restaurant detail page with restaurant data
        router.push({
            pathname: '/restaurant/[id]',
            params: {
                id: restaurant.id,
                name: restaurant.name,
                address: restaurant.formattedAddress || '',
                latitude: restaurant.latitude?.toString() || '',
                longitude: restaurant.longitude?.toString() || '',
            },
        });
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <RestaurantSearch
                theme={theme}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                isSearching={isSearching}
                searchResults={searchResults}
                onSelectRestaurant={handleSelectRestaurant}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
});
