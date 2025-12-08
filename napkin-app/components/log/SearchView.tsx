import React from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SearchResult } from '@/hooks/useRestaurantSearch';

interface SearchViewProps {
    theme: {
        text: string;
        tint: string;
    };
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    isSearching: boolean;
    searchResults: SearchResult[];
    onSelectRestaurant: (restaurant: SearchResult) => void;
}

export function SearchView({
    theme,
    searchQuery,
    setSearchQuery,
    isSearching,
    searchResults,
    onSelectRestaurant,
}: SearchViewProps) {
    return (
        <View style={styles.searchContent}>
            <Text style={[styles.header, { color: theme.text }]}>Find a place</Text>
            <View style={styles.searchContainer}>
                <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search restaurants..."
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoFocus
                />
                {isSearching && <ActivityIndicator size="small" color={theme.tint} />}
            </View>

            <ScrollView style={styles.resultsList}>
                {searchResults.map((item) => (
                    <TouchableOpacity
                        key={item.id}
                        style={styles.resultItem}
                        onPress={() => onSelectRestaurant(item)}
                    >
                        <View style={styles.resultIcon}>
                            <Ionicons name="restaurant" size={24} color="#666" />
                        </View>
                        <View style={styles.resultInfo}>
                            <Text style={[styles.resultName, { color: theme.text }]}>{item.name}</Text>
                            <Text style={styles.resultAddress}>{item.formattedAddress}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color="#ccc" />
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    searchContent: {
        flex: 1,
        padding: 20,
    },
    header: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 24,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 12,
        paddingHorizontal: 12,
        height: 50,
        backgroundColor: '#f9f9f9',
        marginBottom: 20,
    },
    searchIcon: {
        marginRight: 10,
    },
    searchInput: {
        flex: 1,
        height: '100%',
        fontSize: 16,
    },
    resultsList: {
        flex: 1,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    resultIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#f0f0f0',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    resultInfo: {
        flex: 1,
    },
    resultName: {
        fontWeight: '600',
        fontSize: 16,
        marginBottom: 4,
    },
    resultAddress: {
        color: '#666',
        fontSize: 14,
    },
});
