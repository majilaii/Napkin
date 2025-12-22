import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    Modal,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { UserPlace } from '@/hooks/places/useUserPlaces';
import { SearchResult } from '@/hooks/places/useRestaurantSearch';

// Import extracted components
import {
    BentoPhotoGrid,
    DatePickerRow,
    CookedByRow,
    RatingSection,
    NotesSection,
    MetadataSection,
    LocationSearchModal,
} from '.';

interface MealLogModalProps {
    visible: boolean;
    onClose: () => void;
    onSubmit: (data: MealLogData) => void;
    isSubmitting?: boolean;
    userId: string;
}

export interface MealLogData {
    dish_description: string;
    rating: number | null;
    user_place_id: string | null;
    // Restaurant data for linking to real restaurants
    restaurant?: {
        external_id: string;
        name: string;
        location?: {
            address?: string;
            locality?: string;
            country?: string;
        };
        latitude?: number;
        longitude?: number;
    };
    cooked_by: string;
    content: string;
    photos: string[];
    date: Date;
    isLiked: boolean;
}

// Union type for selected location (either restaurant or user place)
type SelectedLocation =
    | { type: 'restaurant'; data: SearchResult }
    | { type: 'userPlace'; data: UserPlace }
    | null;

export function MealLogModal({
    visible,
    onClose,
    onSubmit,
    isSubmitting = false,
    userId,
}: MealLogModalProps) {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    // Form state
    const [photos, setPhotos] = useState<string[]>([]);
    const [rating, setRating] = useState<number>(0);
    const [isLiked, setIsLiked] = useState(false);
    const [notes, setNotes] = useState('');
    const [selectedLocation, setSelectedLocation] = useState<SelectedLocation>(null);
    const [cookedBy, setCookedBy] = useState('');
    const [showLocationSearch, setShowLocationSearch] = useState(false);
    const [mealDate, setMealDate] = useState(new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);

    // Reset when modal closes
    useEffect(() => {
        if (!visible) {
            setPhotos([]);
            setRating(0);
            setIsLiked(false);
            setNotes('');
            setSelectedLocation(null);
            setCookedBy('');
            setShowLocationSearch(false);
            setMealDate(new Date());
            setShowDatePicker(false);
        }
    }, [visible]);

    const handleSelectRestaurant = (restaurant: SearchResult) => {
        setSelectedLocation({ type: 'restaurant', data: restaurant });
    };

    const handleSelectUserPlace = (place: UserPlace) => {
        setSelectedLocation({ type: 'userPlace', data: place });
    };

    const getLocationDisplay = (): { icon: string; name: string } => {
        if (!selectedLocation) {
            return { icon: '', name: 'Add location' };
        }
        if (selectedLocation.type === 'restaurant') {
            return { icon: '🍽️', name: selectedLocation.data.name };
        }
        return { icon: selectedLocation.data.icon, name: selectedLocation.data.name };
    };

    const handleSubmit = () => {
        // Build restaurant data if a restaurant was selected
        let restaurantData: MealLogData['restaurant'] | undefined;
        if (selectedLocation?.type === 'restaurant') {
            const r = selectedLocation.data;
            restaurantData = {
                external_id: r.id,
                name: r.name,
                location: {
                    address: r.formattedAddress || undefined,
                },
                latitude: r.latitude || undefined,
                longitude: r.longitude || undefined,
            };
        }

        onSubmit({
            dish_description: '',
            rating: rating > 0 ? rating : null,
            user_place_id: selectedLocation?.type === 'userPlace' ? selectedLocation.data.id : null,
            restaurant: restaurantData,
            cooked_by: cookedBy.trim(),
            content: notes.trim(),
            photos,
            date: mealDate,
            isLiked,
        });
    };

    const locationDisplay = getLocationDisplay();

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <KeyboardAvoidingView
                style={[styles.container, { backgroundColor: theme.background }]}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: theme.border }]}>
                    <TouchableOpacity onPress={onClose} style={styles.headerButton}>
                        <Text style={[styles.headerButtonText, { color: theme.primary }]}>
                            Cancel
                        </Text>
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>
                        Log a Meal
                    </Text>
                    <TouchableOpacity
                        onPress={handleSubmit}
                        style={styles.headerButton}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? (
                            <ActivityIndicator size="small" color={theme.primary} />
                        ) : (
                            <Text style={[styles.headerButtonText, { color: theme.primary, fontWeight: '600' }]}>
                                Save
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>

                <ScrollView
                    style={styles.content}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    onScrollBeginDrag={Keyboard.dismiss}
                >
                    {/* Photo Area - Bento Grid */}
                    <View style={styles.photoSection}>
                        <BentoPhotoGrid
                            photos={photos}
                            onPhotosChange={setPhotos}
                            maxPhotos={9}
                            theme={theme}
                        />
                    </View>

                    {/* Date Entry Row */}
                    <DatePickerRow
                        date={mealDate}
                        onDateChange={setMealDate}
                        showPicker={showDatePicker}
                        onShowPickerChange={setShowDatePicker}
                        theme={theme}
                        colorScheme={colorScheme}
                    />

                    {/* Who Cooked Row */}
                    <CookedByRow
                        cookedBy={cookedBy}
                        onCookedByChange={setCookedBy}
                        theme={theme}
                    />

                    {/* Rating Section */}
                    <RatingSection
                        rating={rating}
                        onRatingChange={setRating}
                        isLiked={isLiked}
                        onLikedChange={setIsLiked}
                        theme={theme}
                    />

                    {/* Location Row (opens modal) */}
                    <TouchableOpacity
                        style={[styles.locationRow, { borderBottomColor: theme.border }]}
                        onPress={() => setShowLocationSearch(true)}
                    >
                        <View style={styles.locationLeft}>
                            <Ionicons name="location" size={18} color={theme.textSecondary} />
                            <Text style={[styles.locationLabel, { color: theme.textSecondary }]}>
                                Location
                            </Text>
                        </View>
                        <View style={styles.locationRight}>
                            <Text style={[styles.locationValue, { color: theme.text }]}>
                                {locationDisplay.icon} {locationDisplay.name}
                            </Text>
                            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                        </View>
                    </TouchableOpacity>

                    {/* Notes Section (second-last) */}
                    <NotesSection
                        notes={notes}
                        onNotesChange={setNotes}
                        theme={theme}
                    />

                    {/* Tags Section (bottom - coming soon) */}
                    <MetadataSection theme={theme} />
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Location Search Modal */}
            <LocationSearchModal
                visible={showLocationSearch}
                onClose={() => setShowLocationSearch(false)}
                onSelectRestaurant={handleSelectRestaurant}
                onSelectUserPlace={handleSelectUserPlace}
                userId={userId}
            />
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
        padding: 16,
        borderBottomWidth: 1,
    },
    headerButton: {
        width: 70,
    },
    headerButtonText: {
        fontSize: 16,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
    },
    content: {
        flex: 1,
    },
    photoSection: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
    },
    locationLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    locationLabel: {
        fontSize: 15,
    },
    locationRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    locationValue: {
        fontSize: 15,
    },
});
