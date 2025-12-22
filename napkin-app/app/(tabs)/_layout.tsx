import { Tabs, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { LogTypeActionSheet } from '@/components/LogTypeActionSheet';
import { MealLogModal, MealLogData } from '@/components/meal-log/MealLogModal';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateEntry } from '@/hooks/entries/useCreateEntry';


export default function TabLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [mealModalVisible, setMealModalVisible] = useState(false);

  const createEntryMutation = useCreateEntry();

  const handleLogTypeSelect = (type: 'meal' | 'restaurant' | 'table') => {
    setActionSheetVisible(false);
    if (type === 'meal') {
      setMealModalVisible(true);
    } else if (type === 'restaurant') {
      router.push('/restaurant/search');
    }
    // Table coming soon
  };

  const handleMealSubmit = async (data: MealLogData) => {
    if (!userId) return;

    try {
      await createEntryMutation.mutateAsync({
        // Pass restaurant if selected (links entry to restaurant)
        restaurant: data.restaurant,
        // Pass user_place_id if no restaurant was selected
        user_place_id: data.restaurant ? undefined : (data.user_place_id || undefined),
        rating: data.rating,
        content: data.content,
        dish_description: data.dish_description,
        cooked_by: data.cooked_by,
        visited_at: data.date.toISOString(),
        userId,
        // For cache invalidation
        locationId: data.restaurant?.external_id || data.user_place_id || undefined,
      });

      setMealModalVisible(false);
      Alert.alert('Success', 'Meal logged successfully!');
    } catch (e) {
      console.error('Error logging meal:', e);
      Alert.alert('Error', 'Failed to log meal');
    }
  };

  return (
    <>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          headerShown: false,
        }}>

        <Tabs.Screen
          name="explore"
          options={{
            title: 'Explore',
            tabBarIcon: ({ color }) => <Ionicons size={28} name="compass" color={color} />,
          }}
        />

        <Tabs.Screen
          name="log"
          options={{
            title: 'Log',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                size={32}
                name="add-circle"
                color={Colors[colorScheme ?? 'light'].primary}
              />
            ),
            tabBarButton: (props) => (
              <TouchableOpacity
                {...props}
                onPress={() => setActionSheetVisible(true)}
                style={styles.logButton}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color }) => <Ionicons size={28} name="person" color={color} />,
          }}
        />
      </Tabs>

      {/* Log Type Action Sheet */}
      <LogTypeActionSheet
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        onSelect={handleLogTypeSelect}
      />

      {/* Meal Log Modal */}
      <MealLogModal
        visible={mealModalVisible}
        onClose={() => setMealModalVisible(false)}
        onSubmit={handleMealSubmit}
        isSubmitting={createEntryMutation.isPending}
        userId={userId}
      />
    </>
  );
}

const styles = StyleSheet.create({
  logButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
