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
} from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { UserPlace, useUserPlaces } from '@/hooks/useUserPlaces';

// Import extracted components
import {
    BentoPhotoGrid,
    DatePickerRow,
    RatingSection,
    NotesSection,
    PlacePicker,
    MetadataSection,
} from './meal-log';

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
    cooked_by: string;
    content: string;
    photos: string[];
    date: Date;
    isLiked: boolean;
}

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
    const [selectedPlace, setSelectedPlace] = useState<UserPlace | null>(null);
    const [cookedBy, setCookedBy] = useState('');
    const [showPlacePicker, setShowPlacePicker] = useState(false);
    const [mealDate, setMealDate] = useState(new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);

    // Fetch user's saved places
    const { data: userPlaces = [], isLoading: placesLoading } = useUserPlaces(userId);

    // Reset when modal closes
    useEffect(() => {
        if (!visible) {
            setPhotos([]);
            setRating(0);
            setIsLiked(false);
            setNotes('');
            setSelectedPlace(null);
            setCookedBy('');
            setShowPlacePicker(false);
            setMealDate(new Date());
            setShowDatePicker(false);
        }
    }, [visible]);

    // Auto-select Home if available
    useEffect(() => {
        if (userPlaces.length > 0 && !selectedPlace) {
            const home = userPlaces.find(p => p.is_home);
            if (home) setSelectedPlace(home);
        }
    }, [userPlaces, selectedPlace]);

    const handleSubmit = () => {
        onSubmit({
            dish_description: '',
            rating: rating > 0 ? rating : null,
            user_place_id: selectedPlace?.id || null,
            cooked_by: cookedBy.trim(),
            content: notes.trim(),
            photos,
            date: mealDate,
            isLiked,
        });
    };

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

                    {/* Rating Section */}
                    <RatingSection
                        rating={rating}
                        onRatingChange={setRating}
                        isLiked={isLiked}
                        onLikedChange={setIsLiked}
                        theme={theme}
                    />

                    {/* Notes Section */}
                    <NotesSection
                        notes={notes}
                        onNotesChange={setNotes}
                        theme={theme}
                    />

                    {/* Metadata Section */}
                    <MetadataSection
                        cookedBy={cookedBy}
                        onCookedByChange={setCookedBy}
                        theme={theme}
                    >
                        <PlacePicker
                            userId={userId}
                            selectedPlace={selectedPlace}
                            onPlaceSelect={setSelectedPlace}
                            places={userPlaces}
                            isLoading={placesLoading}
                            isExpanded={showPlacePicker}
                            onExpandedChange={setShowPlacePicker}
                            theme={theme}
                        />
                    </MetadataSection>
                </ScrollView>
            </KeyboardAvoidingView>
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
});
