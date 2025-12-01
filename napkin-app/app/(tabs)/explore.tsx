import { Text, StyleSheet, View, Button, ScrollView } from 'react-native';
import { FoursquarePlace, searchRestaurants } from '@/lib/api';
import { useState } from 'react';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { router } from 'expo-router';

export default function TabTwoScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const [restaurants, setRestaurants] = useState<FoursquarePlace[]>([]);

  const handleSearch = async () => {
    const restaurants = await searchRestaurants('restaurant', 'London');
    setRestaurants(restaurants);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={{ color: theme.text, fontSize: 24, marginBottom: 20 }}>Explore</Text>
      <Button title="Search" onPress={handleSearch} color={theme.tint} />
      <Button title="test onboarding" onPress={() => router.push('/onboarding')} color='red' />
      <ScrollView style={{ width: '100%', padding: 20 }}>
        {restaurants.map((restaurant) => (
          <View key={restaurant.id} style={[styles.restaurant, { backgroundColor: theme.tint }]}>
            <Text style={{ color: 'white', fontWeight: 'bold' }}>{restaurant.name}</Text>
            <Text style={{ color: 'white' }}>{restaurant.formattedAddress}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 50,
  },
  restaurant: {
    gap: 4,
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
});
