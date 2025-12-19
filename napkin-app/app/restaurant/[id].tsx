import React from 'react';
import { StyleSheet, SafeAreaView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useRestaurantDetail } from '@/hooks/restaurant/useRestaurantDetail';
import { RestaurantDetails, RestaurantReview } from '@/components/restaurant';
import { LogModal } from '@/components/restaurant/LogModal';
import { EntriesModal } from '@/components/EntriesModal';
import { EditEntryModal } from '@/components/EditEntryModal';
import { SearchResult } from '@/hooks/places/useRestaurantSearch';

export default function RestaurantDetailScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const router = useRouter();

    const params = useLocalSearchParams<{
        id: string;
        name: string;
        address: string;
        latitude: string;
        longitude: string;
    }>();

    // Reconstruct restaurant object from params
    const restaurant: SearchResult = {
        id: params.id || '',
        name: params.name || '',
        formattedAddress: params.address || '',
        latitude: params.latitude ? parseFloat(params.latitude) : undefined,
        longitude: params.longitude ? parseFloat(params.longitude) : undefined,
    };

    // Auth
    const { user } = useAuth();
    const userId = user?.id ?? '';

    // All orchestration logic from custom hook
    const {
        // Modal state
        modalVisible,
        setModalVisible,
        entriesModalVisible,
        setEntriesModalVisible,
        editModalVisible,
        selectedEntry,
        isReviewing,
        setIsReviewing,

        // Review state
        rating,
        setRating,
        reviewText,
        setReviewText,
        valueProfile,

        // Data
        entryHistory,

        // Computed
        initialRating,
        initialToggles,
        hasReviewed,
        visitCount,
        lastVisitDate,

        // Loading
        isSubmitting,
        isDeleting,

        // Handlers
        handleStatusChange,
        handleModalAction,
        handleRate,
        handleSubmitReview,
        handleDeleteEntry,
        handleEditEntry,
        handleSaveEntry,
        handleDeleteEntryById,
        handleCloseEditModal,
    } = useRestaurantDetail(restaurant, userId);

    if (!restaurant.id) {
        return null;
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            {isReviewing ? (
                <RestaurantReview
                    theme={theme}
                    rating={rating}
                    setRating={setRating}
                    valueProfile={valueProfile}
                    reviewText={reviewText}
                    setReviewText={setReviewText}
                    onBack={() => setIsReviewing(false)}
                    onSubmit={handleSubmitReview}
                />
            ) : (
                <RestaurantDetails
                    theme={theme}
                    restaurant={restaurant}
                    onBack={() => router.back()}
                    onOpenModal={() => setModalVisible(true)}
                />
            )}

            {!isReviewing && (
                <LogModal
                    visible={modalVisible}
                    onClose={() => setModalVisible(false)}
                    restaurantName={restaurant.name}
                    onRate={handleRate}
                    onAction={handleModalAction}
                    onDeleteReview={handleDeleteEntry}
                    onStatusChange={handleStatusChange}
                    initialRating={initialRating}
                    initialToggles={initialToggles}
                    hasReviewed={hasReviewed}
                    visitCount={visitCount}
                    lastVisitDate={lastVisitDate}
                />
            )}

            <EntriesModal
                visible={entriesModalVisible}
                onClose={() => setEntriesModalVisible(false)}
                restaurantName={restaurant.name}
                entries={entryHistory}
                isLoading={false}
                onEditEntry={handleEditEntry}
            />

            {selectedEntry && (
                <EditEntryModal
                    visible={editModalVisible}
                    onClose={handleCloseEditModal}
                    entry={selectedEntry}
                    restaurantName={restaurant.name}
                    onSave={handleSaveEntry}
                    onDelete={handleDeleteEntryById}
                    isLoading={isSubmitting || isDeleting}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
});
