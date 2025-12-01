import { useState } from 'react';
import { StyleSheet, TextInput, Button, FlatList, View, Text, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { searchRestaurants, FoursquarePlace } from '@/lib/api';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoursquarePlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('Searching for:', query);
      const data = await searchRestaurants(query, 'London'); // Hardcoded location for testing
      console.log('Got results:', data);
      setResults(data);
    } catch (err: any) {
      console.error('Search failed:', err);
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Foursquare Tester</Text>
      </View>

      <View style={styles.searchBox}>
        <TextInput
          style={styles.input}
          placeholder="Search (e.g. Sushi, Pizza)"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
        <Button title="Search" onPress={handleSearch} disabled={loading} />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {loading && <ActivityIndicator size="large" color="#0000ff" />}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.placeName}>{item.name}</Text>
            <Text style={styles.placeDetails}>
              {item.categories[0]} • {item.locality || 'Unknown City'}
            </Text>
            <Text style={styles.placeAddress}>{item.formattedAddress}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  searchBox: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  error: {
    color: 'red',
    padding: 16,
    textAlign: 'center',
  },
  list: {
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  placeName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  placeDetails: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  placeAddress: {
    fontSize: 12,
    color: '#999',
  },
});
