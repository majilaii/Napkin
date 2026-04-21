-- TICKET-029: Add welcomed_at to table_members for the "added to Table" banner.
--
-- welcomed_at IS NULL  → user was added by an owner and has not yet seen the banner.
-- welcomed_at IS NOT NULL → user dismissed the banner (or was the table creator).
--
-- Mitigation for creator false-positive: the WelcomeBanner component gates on
-- `role !== 'admin'` so Table creators (who are inserted with role='admin') never
-- see the banner regardless of this column's value. No backfill needed.
--
-- Nullable column with no default — safe to add on a hot table (no lock, no backfill).

ALTER TABLE table_members
    ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ NULL;
