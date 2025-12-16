import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserPlace, useCreateUserPlace } from '@/hooks/useUserPlaces';

interface PlacePickerProps {
    userId: string;
    selectedPlace: UserPlace | null;
    onPlaceSelect: (place: UserPlace | null) => void;
    places: UserPlace[];
    isLoading: boolean;
    isExpanded: boolean;
    onExpandedChange: (expanded: boolean) => void;
    theme: {
        border: string;
        text: string;
        textSecondary: string;
        primary: string;
        card: string;
    };
}

export function PlacePicker({
    userId,
    selectedPlace,
    onPlaceSelect,
    places,
    isLoading,
    isExpanded,
    onExpandedChange,
    theme,
}: PlacePickerProps) {
    const [newPlaceName, setNewPlaceName] = useState('');
    const [isAddingPlace, setIsAddingPlace] = useState(false);
    const createPlaceMutation = useCreateUserPlace();

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
            onPlaceSelect(newPlace);
            setNewPlaceName('');
            setIsAddingPlace(false);
            onExpandedChange(false);
        } catch (error) {
            Alert.alert('Error', 'Failed to add location. Please try again.');
        }
    };

    return (
        <View>
            {/* Location Row */}
            <TouchableOpacity
                style={[styles.metadataRow, { borderBottomColor: theme.border }]}
                onPress={() => onExpandedChange(!isExpanded)}
            >
                <View style={styles.metadataLeft}>
                    <Ionicons name="location" size={20} color={theme.textSecondary} />
                    <Text style={[styles.metadataLabel, { color: theme.textSecondary }]}>
                        Location
                    </Text>
                </View>
                <View style={styles.metadataRight}>
                    <Text style={[styles.metadataValue, { color: theme.text }]}>
                        {selectedPlace?.icon} {selectedPlace?.name || 'Add location'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                </View>
            </TouchableOpacity>

            {/* Place Picker Dropdown */}
            {isExpanded && (
                <View style={[styles.placePickerDropdown, { backgroundColor: theme.card }]}>
                    {isLoading ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                    ) : (
                        <>
                            {places.map((place) => (
                                <TouchableOpacity
                                    key={place.id}
                                    style={[
                                        styles.placeOption,
                                        selectedPlace?.id === place.id && { backgroundColor: theme.primary + '20' },
                                    ]}
                                    onPress={() => {
                                        onPlaceSelect(place);
                                        onExpandedChange(false);
                                    }}
                                >
                                    <Text style={{ fontSize: 16 }}>{place.icon}</Text>
                                    <Text style={[styles.placeOptionText, { color: theme.text }]}>
                                        {place.name}
                                    </Text>
                                    {selectedPlace?.id === place.id && (
                                        <Ionicons name="checkmark" size={18} color={theme.primary} />
                                    )}
                                </TouchableOpacity>
                            ))}

                            {/* Add New Location */}
                            {isAddingPlace ? (
                                <View style={styles.addPlaceRow}>
                                    <TextInput
                                        style={[styles.addPlaceInput, { color: theme.text, borderColor: theme.border }]}
                                        placeholder="Enter place name..."
                                        placeholderTextColor={theme.textSecondary}
                                        value={newPlaceName}
                                        onChangeText={setNewPlaceName}
                                        autoFocus
                                        onSubmitEditing={handleAddNewPlace}
                                    />
                                    <TouchableOpacity
                                        style={[styles.addPlaceButton, { backgroundColor: theme.primary }]}
                                        onPress={handleAddNewPlace}
                                        disabled={createPlaceMutation.isPending}
                                    >
                                        {createPlaceMutation.isPending ? (
                                            <ActivityIndicator size="small" color="#fff" />
                                        ) : (
                                            <Ionicons name="checkmark" size={18} color="#fff" />
                                        )}
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.addPlaceCancelButton, { borderColor: theme.border }]}
                                        onPress={() => {
                                            setIsAddingPlace(false);
                                            setNewPlaceName('');
                                        }}
                                    >
                                        <Ionicons name="close" size={18} color={theme.textSecondary} />
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <TouchableOpacity
                                    style={styles.placeOption}
                                    onPress={() => setIsAddingPlace(true)}
                                >
                                    <Ionicons name="add-circle-outline" size={20} color={theme.primary} />
                                    <Text style={[styles.placeOptionText, { color: theme.primary }]}>
                                        Add new location
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    metadataRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
    },
    metadataLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    metadataLabel: {
        fontSize: 15,
    },
    metadataRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    metadataValue: {
        fontSize: 15,
    },
    placePickerDropdown: {
        paddingVertical: 8,
    },
    placeOption: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
        gap: 10,
    },
    placeOptionText: {
        flex: 1,
        fontSize: 15,
    },
    addPlaceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 20,
        gap: 8,
    },
    addPlaceInput: {
        flex: 1,
        fontSize: 15,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderRadius: 8,
    },
    addPlaceButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addPlaceCancelButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
});
