import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Modal,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Alert,
    SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRestaurantSearch, SearchResult } from '@/hooks/places/useRestaurantSearch';
import { UserPlace, useUserPlaces, useCreateUserPlace } from '@/hooks/places/useUserPlaces';

type TabType = 'restaurants' | 'myPlaces';

interface LocationSearchModalProps {
    visible: boolean;
    onClose: () => void;
    onSelectRestaurant: (restaurant: SearchResult) => void;
    onSelectUserPlace: (place: UserPlace) => void;
    userId: string;
}

export function LocationSearchModal({
    visible,
    onClose,
    onSelectRestaurant,
    onSelectUserPlace,
    userId,
}: LocationSearchModalProps) {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const [activeTab, setActiveTab] = useState<TabType>('restaurants');
    const [searchQuery, setSearchQuery] = useState('');
    const [newPlaceName, setNewPlaceName] = useState('');
    const [isAddingPlace, setIsAddingPlace] = useState(false);

    // Restaurant search
    const { data: searchResults = [], isLoading: isSearching } = useRestaurantSearch(searchQuery);

    // User places
    const { data: userPlaces = [], isLoading: placesLoading } = useUserPlaces(userId);
    const createPlaceMutation = useCreateUserPlace();

    const handleSelectRestaurant = (restaurant: SearchResult) => {
        onSelectRestaurant(restaurant);
        setSearchQuery('');
        onClose();
    };

    const handleSelectUserPlace = (place: UserPlace) => {
        onSelectUserPlace(place);
        onClose();
    };

    const handleAddNewPlace = async () => {
        if (!newPlaceName.trim()) {
            Alert.alert('Error', 'Please enter a place name');
            return;
        }

        try {
            const newPlace = await createPlaceMutation.mutateAsync({
                userId,
                name: newPlaceName.trim(),
                icon: '📍',
            });
            onSelectUserPlace(newPlace);
            setNewPlaceName('');
            setIsAddingPlace(false);
            onClose();
        } catch (error) {
            Alert.alert('Error', 'Failed to add location. Please try again.');
        }
    };

    const handleClose = () => {
        setSearchQuery('');
        setNewPlaceName('');
        setIsAddingPlace(false);
        onClose();
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={handleClose}
        >
            <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: theme.border }]}>
                    <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                        <Ionicons name="close" size={24} color={theme.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>
                        Add Location
                    </Text>
                    <View style={styles.closeButton} />
                </View>

                {/* Tabs */}
                <View style={[styles.tabContainer, { borderBottomColor: theme.border }]}>
                    <TouchableOpacity
                        style={[
                            styles.tab,
                            activeTab === 'restaurants' && { borderBottomColor: theme.primary, borderBottomWidth: 2 },
                        ]}
                        onPress={() => setActiveTab('restaurants')}
                    >
                        <Ionicons
                            name="restaurant"
                            size={18}
                            color={activeTab === 'restaurants' ? theme.primary : theme.textSecondary}
                        />
                        <Text style={[
                            styles.tabText,
                            { color: activeTab === 'restaurants' ? theme.primary : theme.textSecondary },
                        ]}>
                            Restaurants
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[
                            styles.tab,
                            activeTab === 'myPlaces' && { borderBottomColor: theme.primary, borderBottomWidth: 2 },
                        ]}
                        onPress={() => setActiveTab('myPlaces')}
                    >
                        <Ionicons
                            name="home"
                            size={18}
                            color={activeTab === 'myPlaces' ? theme.primary : theme.textSecondary}
                        />
                        <Text style={[
                            styles.tabText,
                            { color: activeTab === 'myPlaces' ? theme.primary : theme.textSecondary },
                        ]}>
                            My Places
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Content */}
                {activeTab === 'restaurants' ? (
                    <View style={styles.content}>
                        {/* Search Input */}
                        <View style={[styles.searchContainer, { backgroundColor: theme.card }]}>
                            <Ionicons name="search" size={20} color={theme.textSecondary} />
                            <TextInput
                                style={[styles.searchInput, { color: theme.text }]}
                                placeholder="Search restaurants..."
                                placeholderTextColor={theme.textSecondary}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                autoFocus
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => setSearchQuery('')}>
                                    <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Results */}
                        <ScrollView style={styles.resultsList} showsVerticalScrollIndicator={false}>
                            {isSearching ? (
                                <ActivityIndicator style={styles.loader} color={theme.primary} />
                            ) : searchQuery.length < 3 ? (
                                <Text style={[styles.hintText, { color: theme.textSecondary }]}>
                                    Type at least 3 characters to search
                                </Text>
                            ) : searchResults.length === 0 ? (
                                <Text style={[styles.hintText, { color: theme.textSecondary }]}>
                                    No restaurants found
                                </Text>
                            ) : (
                                searchResults.map((result) => (
                                    <TouchableOpacity
                                        key={result.id}
                                        style={[styles.resultItem, { borderBottomColor: theme.border }]}
                                        onPress={() => handleSelectRestaurant(result)}
                                    >
                                        <View style={[styles.resultIcon, { backgroundColor: theme.card }]}>
                                            <Ionicons name="restaurant" size={20} color={theme.textSecondary} />
                                        </View>
                                        <View style={styles.resultInfo}>
                                            <Text style={[styles.resultName, { color: theme.text }]} numberOfLines={1}>
                                                {result.name}
                                            </Text>
                                            <Text style={[styles.resultAddress, { color: theme.textSecondary }]} numberOfLines={1}>
                                                {result.formattedAddress}
                                            </Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                                    </TouchableOpacity>
                                ))
                            )}
                        </ScrollView>
                    </View>
                ) : (
                    <View style={styles.content}>
                        {/* My Places List */}
                        <ScrollView style={styles.resultsList} showsVerticalScrollIndicator={false}>
                            {placesLoading ? (
                                <ActivityIndicator style={styles.loader} color={theme.primary} />
                            ) : (
                                <>
                                    {userPlaces.map((place) => (
                                        <TouchableOpacity
                                            key={place.id}
                                            style={[styles.resultItem, { borderBottomColor: theme.border }]}
                                            onPress={() => handleSelectUserPlace(place)}
                                        >
                                            <Text style={styles.placeIcon}>{place.icon}</Text>
                                            <View style={styles.resultInfo}>
                                                <Text style={[styles.resultName, { color: theme.text }]}>
                                                    {place.name}
                                                </Text>
                                                {place.address && (
                                                    <Text style={[styles.resultAddress, { color: theme.textSecondary }]} numberOfLines={1}>
                                                        {place.address}
                                                    </Text>
                                                )}
                                            </View>
                                            <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                                        </TouchableOpacity>
                                    ))}

                                    {/* Add New Place */}
                                    {isAddingPlace ? (
                                        <View style={styles.addPlaceContainer}>
                                            <TextInput
                                                style={[styles.addPlaceInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                                                placeholder="Enter place name..."
                                                placeholderTextColor={theme.textSecondary}
                                                value={newPlaceName}
                                                onChangeText={setNewPlaceName}
                                                autoFocus
                                                onSubmitEditing={handleAddNewPlace}
                                            />
                                            <View style={styles.addPlaceButtons}>
                                                <TouchableOpacity
                                                    style={[styles.addPlaceButton, { backgroundColor: theme.primary }]}
                                                    onPress={handleAddNewPlace}
                                                    disabled={createPlaceMutation.isPending}
                                                >
                                                    {createPlaceMutation.isPending ? (
                                                        <ActivityIndicator size="small" color="#fff" />
                                                    ) : (
                                                        <Text style={styles.addPlaceButtonText}>Add</Text>
                                                    )}
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[styles.cancelButton, { borderColor: theme.border }]}
                                                    onPress={() => {
                                                        setIsAddingPlace(false);
                                                        setNewPlaceName('');
                                                    }}
                                                >
                                                    <Text style={[styles.cancelButtonText, { color: theme.textSecondary }]}>Cancel</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    ) : (
                                        <TouchableOpacity
                                            style={[styles.resultItem, { borderBottomColor: theme.border }]}
                                            onPress={() => setIsAddingPlace(true)}
                                        >
                                            <View style={[styles.resultIcon, { backgroundColor: theme.primary + '20' }]}>
                                                <Ionicons name="add" size={20} color={theme.primary} />
                                            </View>
                                            <Text style={[styles.addPlaceText, { color: theme.primary }]}>
                                                Add a new place
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </>
                            )}
                        </ScrollView>
                    </View>
                )}
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    closeButton: {
        width: 40,
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
    },
    tabContainer: {
        flexDirection: 'row',
        borderBottomWidth: 1,
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        gap: 6,
    },
    tabText: {
        fontSize: 14,
        fontWeight: '500',
    },
    content: {
        flex: 1,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        margin: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
    },
    resultsList: {
        flex: 1,
    },
    loader: {
        marginTop: 40,
    },
    hintText: {
        textAlign: 'center',
        marginTop: 40,
        fontSize: 14,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        gap: 12,
    },
    resultIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    placeIcon: {
        fontSize: 24,
        width: 40,
        textAlign: 'center',
    },
    resultInfo: {
        flex: 1,
    },
    resultName: {
        fontSize: 16,
        fontWeight: '500',
    },
    resultAddress: {
        fontSize: 13,
        marginTop: 2,
    },
    addPlaceText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '500',
    },
    addPlaceContainer: {
        padding: 16,
        gap: 12,
    },
    addPlaceInput: {
        fontSize: 16,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderRadius: 10,
    },
    addPlaceButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    addPlaceButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: 'center',
    },
    addPlaceButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    cancelButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: 'center',
    },
    cancelButtonText: {
        fontSize: 16,
    },
});
