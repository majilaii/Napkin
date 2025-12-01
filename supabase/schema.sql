-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.list_items (
  list_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  note text,
  position integer,
  CONSTRAINT list_items_pkey PRIMARY KEY (list_id, restaurant_id),
  CONSTRAINT list_items_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.lists(id),
  CONSTRAINT list_items_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);
CREATE TABLE public.lists (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  is_public boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lists_pkey PRIMARY KEY (id),
  CONSTRAINT lists_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(user_id)
);
CREATE TABLE public.profiles (
  user_id uuid NOT NULL,
  display_name text NOT NULL,
  bio text,
  home_city text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.restaurants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  city text,
  country text,
  google_place_id text UNIQUE,
  lat double precision,
  lng double precision,
  created_at timestamp with time zone DEFAULT now(),
  foursquare_id text UNIQUE,
  CONSTRAINT restaurants_pkey PRIMARY KEY (id)
);
CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  rating double precision NOT NULL CHECK (rating >= 0.5::double precision AND rating <= 5.0::double precision),
  value_profile jsonb NOT NULL,
  content text,
  visited_at date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reviews_pkey PRIMARY KEY (id),
  CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT reviews_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);
CREATE TABLE public.table_members (
  table_id uuid NOT NULL,
  member_id uuid NOT NULL,
  role text DEFAULT 'member'::text,
  joined_at timestamp with time zone DEFAULT now(),
  CONSTRAINT table_members_pkey PRIMARY KEY (table_id, member_id),
  CONSTRAINT table_members_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.tables(id),
  CONSTRAINT table_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(user_id)
);
CREATE TABLE public.tables (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tables_pkey PRIMARY KEY (id),
  CONSTRAINT tables_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(user_id)
);
CREATE TABLE public.value_profiles (
  user_id uuid NOT NULL,
  flavor integer NOT NULL,
  ambience integer NOT NULL,
  value integer NOT NULL,
  location integer NOT NULL,
  service integer NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT value_profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT value_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id)
);
CREATE TABLE public.visit_companions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL,
  companion_user uuid,
  companion_name text,
  CONSTRAINT visit_companions_pkey PRIMARY KEY (id),
  CONSTRAINT visit_companions_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id),
  CONSTRAINT visit_companions_companion_user_fkey FOREIGN KEY (companion_user) REFERENCES public.profiles(user_id)
);
CREATE TABLE public.visit_dishes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL,
  name text NOT NULL,
  note text,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  CONSTRAINT visit_dishes_pkey PRIMARY KEY (id),
  CONSTRAINT visit_dishes_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id)
);
CREATE TABLE public.visit_photos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL,
  storage_path text NOT NULL,
  caption text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT visit_photos_pkey PRIMARY KEY (id),
  CONSTRAINT visit_photos_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id)
);
CREATE TABLE public.visit_tables (
  visit_id uuid NOT NULL,
  table_id uuid NOT NULL,
  CONSTRAINT visit_tables_pkey PRIMARY KEY (visit_id, table_id),
  CONSTRAINT visit_tables_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id),
  CONSTRAINT visit_tables_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.tables(id)
);
CREATE TABLE public.visits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  visited_on date NOT NULL,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  journal_entry text,
  privacy USER-DEFINED DEFAULT 'private'::visit_privacy,
  vibe_tags ARRAY DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT visits_pkey PRIMARY KEY (id),
  CONSTRAINT visits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id),
  CONSTRAINT visits_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);
