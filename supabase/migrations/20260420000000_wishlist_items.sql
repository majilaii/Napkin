-- 20260420000000_wishlist_items.sql
-- Personal wishlist (no table_id column by design — Table overlap is a derived read-time query).
-- Doctrine: there is no "add to Table wishlist" action; the schema enforces this by having no
-- table_id column. A Table's wishlist is computed as restaurants saved by ≥1 of its members.

-- 1. Create wishlist_items table
CREATE TABLE IF NOT EXISTS public.wishlist_items (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    restaurant_id UUID       NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Unique index: one wishlist entry per (user, restaurant). Also used for ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS wishlist_items_user_restaurant_idx
    ON public.wishlist_items (user_id, restaurant_id);

-- 3. Secondary indexes for fast single-dimension lookups
CREATE INDEX IF NOT EXISTS wishlist_items_user_id_idx
    ON public.wishlist_items (user_id);

CREATE INDEX IF NOT EXISTS wishlist_items_restaurant_id_idx
    ON public.wishlist_items (restaurant_id);

-- 4. Enable Row Level Security
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies
--    SELECT: own rows, OR caller shares a Table with the row's user_id
--    (needed so Table-view aggregation can work via PostgREST if ever used directly).
--    The edge function uses service role and bypasses RLS, but the policy keeps the door open.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'wishlist_items'
          AND policyname = 'wishlist_items select policy'
    ) THEN
        CREATE POLICY "wishlist_items select policy"
        ON public.wishlist_items FOR SELECT
        USING (
            auth.uid() = user_id
            OR EXISTS (
                SELECT 1
                FROM public.table_members tm1
                JOIN public.table_members tm2
                  ON tm1.table_id = tm2.table_id
                WHERE tm1.member_id = auth.uid()
                  AND tm2.member_id = wishlist_items.user_id
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'wishlist_items'
          AND policyname = 'wishlist_items insert policy'
    ) THEN
        CREATE POLICY "wishlist_items insert policy"
        ON public.wishlist_items FOR INSERT
        WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'wishlist_items'
          AND policyname = 'wishlist_items update policy'
    ) THEN
        CREATE POLICY "wishlist_items update policy"
        ON public.wishlist_items FOR UPDATE
        USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'wishlist_items'
          AND policyname = 'wishlist_items delete policy'
    ) THEN
        CREATE POLICY "wishlist_items delete policy"
        ON public.wishlist_items FOR DELETE
        USING (auth.uid() = user_id);
    END IF;
END;
$$;

-- 6. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wishlist_items TO authenticated;
GRANT ALL ON public.wishlist_items TO service_role;
