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

// Review types
export interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  foursquare_id: string | null;
  lat: number | null;
  lng: number | null;
}

export interface Review {
  id: string;
  user_id: string;
  restaurant_id: string;
  rating: number;
  value_profile: {
    flavor: number;
    ambience: number;
    value: number;
    service: number;
  };
  content: string | null;
  visited_at: string;
  created_at: string;
  restaurant: Restaurant;
}

export async function getUserReviews(userId: string): Promise<Review[]> {
  console.log('getUserReviews: Calling get-reviews function for user:', userId);

  try {
    const { data, error } = await supabase.functions.invoke('get-reviews', {
      body: { user_id: userId },
    });

    console.log('getUserReviews: Response received', { data, error });

    if (error) {
      console.error('getUserReviews: Function error:', error);
      if (error instanceof FunctionsHttpError) {
        try {
          const errorMessage = await error.context.json();
          console.error('getUserReviews: Error details:', errorMessage);
          throw new Error(errorMessage.error || 'Failed to fetch reviews');
        } catch (parseError) {
          console.error('getUserReviews: Could not parse error response');
          throw error;
        }
      }
      throw error;
    }

    console.log('getUserReviews: Success, got', data?.data?.length ?? 0, 'reviews');
    return (data?.data ?? []) as Review[];
  } catch (err) {
    console.error('getUserReviews: Caught exception:', err);
    throw err;
  }
}
