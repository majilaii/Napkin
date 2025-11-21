import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface FoursquarePlace {
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
  const { data, error } = await supabase.functions.invoke('foursquare-search', {
    body: {
      query,
      near,
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

  return data.data as FoursquarePlace[];
}


