-- TICKET-010: Add last_seen_at to table_members for unseen-dot system.
-- No backfill: existing rows start at NULL, which renders "all dots on" for
-- one session, then clears on first mark-seen write. Accepted v1 behavior.

ALTER TABLE table_members
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NULL;
