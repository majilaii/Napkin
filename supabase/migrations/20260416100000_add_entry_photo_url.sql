-- Add user-uploaded photo URL column to entries
ALTER TABLE entries ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Create entry-photos storage bucket for user-uploaded photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('entry-photos', 'entry-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read: anyone can view entry photos
CREATE POLICY "Public read entry-photos"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'entry-photos');

-- Authenticated upload: users may only write to their own folder ({user_id}/...)
CREATE POLICY "Authenticated upload own folder entry-photos"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'entry-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Authenticated delete: users may only delete their own files
CREATE POLICY "Authenticated delete own files entry-photos"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'entry-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
