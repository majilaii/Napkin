-- Create user_restaurant_status table for storing toggle states (been, liked, want_to_try)
-- This is separate from reviews which tracks individual visits

CREATE TABLE IF NOT EXISTS public.user_restaurant_status (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    been BOOLEAN DEFAULT FALSE,
    liked BOOLEAN DEFAULT FALSE,
    want_to_try BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, restaurant_id)
);

-- Enable RLS
ALTER TABLE public.user_restaurant_status ENABLE ROW LEVEL SECURITY;

-- Users can only see their own status
CREATE POLICY "Users can view own status"
    ON public.user_restaurant_status
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own status
CREATE POLICY "Users can insert own status"
    ON public.user_restaurant_status
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own status
CREATE POLICY "Users can update own status"
    ON public.user_restaurant_status
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own status
CREATE POLICY "Users can delete own status"
    ON public.user_restaurant_status
    FOR DELETE
    USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON TABLE public.user_restaurant_status TO authenticated;
GRANT SELECT ON TABLE public.user_restaurant_status TO anon;

-- Create index for faster lookups
CREATE INDEX idx_user_restaurant_status_user_id ON public.user_restaurant_status(user_id);
CREATE INDEX idx_user_restaurant_status_restaurant_id ON public.user_restaurant_status(restaurant_id);

-- Add comment
COMMENT ON TABLE public.user_restaurant_status IS 'Stores per-user toggle states for restaurants (been, liked, want_to_try)';
