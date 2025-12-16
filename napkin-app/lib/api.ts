import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface Place {
  id: string;
  name: string;
  formattedAddress: string | null;
  locality: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  categories: string[];
  distance: number | null;
  website: string | null;
  link: string | null;
}

export async function searchRestaurants(query: string, near?: string, latitude?: number, longitude?: number) {
  const { data, error } = await supabase.functions.invoke('places-search', {
    body: {
      query,
      latitude,
      longitude,
      limit: 10,
    },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const errorMessage = await error.context.json();
      console.error('Edge Function returned an error:', errorMessage);
      throw new Error(errorMessage.error || 'Search failed');
    }
    console.error('Search error:', error);
    throw error;
  }

  return data.data as Place[];
}

// Location types
export interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  external_id: string | null;
  lat: number | null;
  lng: number | null;
}

export interface UserPlace {
  id: string;
  name: string;
  address: string | null;
  icon: string;
  is_home: boolean;
}

// Entry type (unified meal log)
export interface Entry {
  id: string;
  user_id: string;
  restaurant_id: string | null;
  place_id: string | null;
  user_place_id: string | null;
  rating: number | null;
  content: string | null;
  dish_description: string | null;
  cooked_by: string | null;
  value_profile: {
    flavor?: number;
    ambience?: number;
    value?: number;
    service?: number;
  } | null;
  visited_at: string;
  created_at: string;
  // Joined data
  restaurant?: Restaurant;
  user_place?: UserPlace;
}

export async function getUserEntries(userId: string): Promise<Entry[]> {
  console.log('getUserEntries: Fetching entries for user:', userId);

  try {
    const { data, error } = await supabase
      .from('entries')
      .select(`
        *,
        restaurant:restaurants(id, name, address, city, country, external_id, lat, lng),
        user_place:user_places(id, name, address, icon, is_home)
      `)
      .eq('user_id', userId)
      .order('visited_at', { ascending: false });

    if (error) {
      console.error('getUserEntries: Error:', error);
      throw error;
    }

    console.log('getUserEntries: Success, got', data?.length ?? 0, 'entries');
    return (data ?? []) as Entry[];
  } catch (err) {
    console.error('getUserEntries: Caught exception:', err);
    throw err;
  }
}

