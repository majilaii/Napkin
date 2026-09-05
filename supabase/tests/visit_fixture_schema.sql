-- Narrow native-Postgres dependency fixture. This is intentionally not a full
-- Supabase migration replay. The harness loads actual production definitions
-- for entry creation, image binding/writers/GC, and canonical resolution.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users (id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text,
    created_at timestamptz, updated_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY REFERENCES auth.users(id), display_name text, account_privacy text);
CREATE TABLE public.restaurants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
    external_id text UNIQUE, merged_into uuid REFERENCES public.restaurants(id),
    verification text DEFAULT 'verified', created_by uuid, address text, city text, country text);
CREATE TABLE public.user_places (id uuid PRIMARY KEY);
CREATE TABLE public.places (id uuid PRIMARY KEY);
CREATE TABLE public.tables (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid, name text);
CREATE TABLE public.table_members (table_id uuid REFERENCES public.tables(id), member_id uuid REFERENCES auth.users(id),
    role text, PRIMARY KEY (table_id, member_id));
CREATE TABLE public.table_nights (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid,
    restaurant_id uuid, host_user_id uuid, kind text, status text, is_async boolean);
CREATE TABLE public.suppers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid, host_user_id uuid);
CREATE TABLE public.entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
    restaurant_id uuid REFERENCES public.restaurants(id), place_id uuid, user_place_id uuid,
    rating double precision, content text, dish_description text, cooked_by text, value_profile jsonb,
    visited_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
    vibe_rating numeric, flavor_rating numeric, service_rating numeric, value_rating numeric,
    table_id uuid REFERENCES public.tables(id), table_night_id uuid REFERENCES public.table_nights(id),
    supper_id uuid REFERENCES public.suppers(id), visibility text, liked boolean DEFAULT false, photo_url text,
    client_nonce uuid, UNIQUE(user_id, client_nonce)
);
CREATE TABLE public.entry_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id uuid REFERENCES public.entries(id) ON DELETE CASCADE, photo_url text, sort_order integer);
CREATE TABLE public.entry_tables (entry_id uuid REFERENCES public.entries(id) ON DELETE CASCADE,
    table_id uuid REFERENCES public.tables(id), posted_at timestamptz, PRIMARY KEY(entry_id, table_id));
CREATE TABLE public.entry_participants (entry_id uuid REFERENCES public.entries(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id), rating numeric, notes text, PRIMARY KEY(entry_id, user_id));
CREATE TABLE public.entry_companions (entry_id uuid REFERENCES public.entries(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id), PRIMARY KEY(entry_id,user_id));
CREATE TABLE public.round_entries (round_id uuid REFERENCES public.table_nights(id),
    entry_id uuid REFERENCES public.entries(id) ON DELETE CASCADE, table_id uuid, UNIQUE(entry_id));
CREATE TABLE public.account_deletions (user_id uuid PRIMARY KEY);
CREATE TABLE public.user_restaurant_status (user_id uuid, restaurant_id uuid, been boolean, liked boolean,
    PRIMARY KEY(user_id,restaurant_id));
CREATE TABLE public.wishlist_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
    restaurant_id uuid, note text, deleted_at timestamptz);
CREATE FUNCTION public.is_table_member(p_table uuid, p_user uuid) RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (SELECT 1 FROM public.table_members WHERE table_id=p_table AND member_id=p_user);
$$;
