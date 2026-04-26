-- TICKET-037: Add client_nonce to entries for idempotent submission (TICKET-036 consumes this).
-- Partial unique index so null nonces don't collide with each other.

ALTER TABLE public.entries ADD COLUMN IF NOT EXISTS client_nonce uuid;

CREATE UNIQUE INDEX IF NOT EXISTS entries_user_client_nonce_uidx
    ON public.entries (user_id, client_nonce) WHERE client_nonce IS NOT NULL;
