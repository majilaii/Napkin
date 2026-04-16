CREATE TABLE public.entry_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entry_photos_entry_id ON public.entry_photos(entry_id);
CREATE UNIQUE INDEX idx_entry_photos_entry_sort ON public.entry_photos(entry_id, sort_order);

ALTER TABLE public.entry_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entry_photos_select" ON public.entry_photos FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM entries e
        WHERE e.id = entry_photos.entry_id
        AND (e.user_id = auth.uid()
             OR e.table_id IN (SELECT table_id FROM table_members WHERE user_id = auth.uid()))
    )
);

CREATE POLICY "entry_photos_insert" ON public.entry_photos FOR INSERT WITH CHECK (
    entry_id IN (SELECT id FROM entries WHERE user_id = auth.uid())
);

CREATE POLICY "entry_photos_delete" ON public.entry_photos FOR DELETE USING (
    entry_id IN (SELECT id FROM entries WHERE user_id = auth.uid())
);

-- No UPDATE policy — photos are immutable (delete and re-upload)
ALTER PUBLICATION supabase_realtime ADD TABLE entry_photos;
