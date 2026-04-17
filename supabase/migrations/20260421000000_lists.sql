-- ────────────────────────────────────────────────────────────────────────────
-- TICKET-018: Lists primitive
-- Two tables: lists (parent) + list_entries (items).
-- RLS pre-wired for TICKET-020 (non-owner reads of public lists).
-- ────────────────────────────────────────────────────────────────────────────

-- ── lists ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lists (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title       TEXT         NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 60),
    description TEXT         CHECK (description IS NULL OR char_length(description) <= 140),
    ranked      BOOLEAN      NOT NULL DEFAULT false,
    privacy     TEXT         NOT NULL DEFAULT 'public'
                             CHECK (privacy IN ('public', 'private')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Add columns that may be missing if the table was created outside this migration
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lists' AND column_name='privacy') THEN
        ALTER TABLE public.lists ADD COLUMN privacy TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'private'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lists' AND column_name='ranked') THEN
        ALTER TABLE public.lists ADD COLUMN ranked BOOLEAN NOT NULL DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lists' AND column_name='description') THEN
        ALTER TABLE public.lists ADD COLUMN description TEXT CHECK (description IS NULL OR char_length(description) <= 140);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS lists_owner_id_idx      ON public.lists(owner_id);
CREATE INDEX IF NOT EXISTS lists_owner_updated_idx ON public.lists(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS lists_public_idx        ON public.lists(privacy) WHERE privacy = 'public';

-- ── list_entries ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.list_entries (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id       UUID         NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
    restaurant_id UUID         NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    note          TEXT         CHECK (note IS NULL OR char_length(note) <= 140),
    position      INTEGER      NOT NULL DEFAULT 0, -- gap-allocated; used only for ranked lists
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS list_entries_list_restaurant_idx ON public.list_entries(list_id, restaurant_id);
CREATE INDEX IF NOT EXISTS list_entries_list_position_idx ON public.list_entries(list_id, position);
CREATE INDEX IF NOT EXISTS list_entries_list_created_idx  ON public.list_entries(list_id, created_at DESC);

-- ── Trigger: bump lists.updated_at when entries change ───────────────────
CREATE OR REPLACE FUNCTION public.touch_list_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'list_entries' THEN
        UPDATE public.lists
           SET updated_at = now()
         WHERE id = COALESCE(NEW.list_id, OLD.list_id);
    ELSE
        -- lists table self-touch
        NEW.updated_at = now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lists_touch_on_entry_change ON public.list_entries;
CREATE TRIGGER lists_touch_on_entry_change
    AFTER INSERT OR UPDATE OR DELETE
    ON public.list_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_list_updated_at();

DROP TRIGGER IF EXISTS lists_self_touch ON public.lists;
CREATE TRIGGER lists_self_touch
    BEFORE UPDATE ON public.lists
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_list_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.lists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_entries  ENABLE ROW LEVEL SECURITY;

-- lists: owner OR public (pre-wires TICKET-020 cross-user reads)
DROP POLICY IF EXISTS "lists_select" ON public.lists;
CREATE POLICY "lists_select" ON public.lists FOR SELECT
    USING (auth.uid() = owner_id OR privacy = 'public');
DROP POLICY IF EXISTS "lists_insert" ON public.lists;
CREATE POLICY "lists_insert" ON public.lists FOR INSERT
    WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "lists_update" ON public.lists;
CREATE POLICY "lists_update" ON public.lists FOR UPDATE
    USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "lists_delete" ON public.lists;
CREATE POLICY "lists_delete" ON public.lists FOR DELETE
    USING (auth.uid() = owner_id);

-- list_entries: visible iff parent list is visible (owner OR public)
DROP POLICY IF EXISTS "list_entries_select" ON public.list_entries;
CREATE POLICY "list_entries_select" ON public.list_entries FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.lists l
        WHERE l.id = list_entries.list_id
          AND (l.owner_id = auth.uid() OR l.privacy = 'public')
    ));

-- INSERT/UPDATE/DELETE: only the list owner
DROP POLICY IF EXISTS "list_entries_write" ON public.list_entries;
CREATE POLICY "list_entries_write" ON public.list_entries FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.lists l
        WHERE l.id = list_entries.list_id AND l.owner_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.lists l
        WHERE l.id = list_entries.list_id AND l.owner_id = auth.uid()
    ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lists, public.list_entries TO authenticated;
GRANT ALL ON public.lists, public.list_entries TO service_role;
