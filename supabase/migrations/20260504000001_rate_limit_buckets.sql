-- TICKET-053: Rate-limit buckets table + atomic check-and-increment SQL function.
-- Architecture decision [H3]: Postgres for atomicity, no Deno KV.
-- RLS disabled — only service-role / SECURITY DEFINER access.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    user_id         uuid        NOT NULL,
    bucket_key      text        NOT NULL,
    window_start    timestamptz NOT NULL,
    count           int         NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, bucket_key, window_start)
);

-- RLS off — service-role only via SQL function
ALTER TABLE rate_limit_buckets DISABLE ROW LEVEL SECURITY;

-- ── Atomic SQL function ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_and_increment_rate_limit(
    p_user_id        uuid,
    p_bucket_key     text,
    p_max            int,
    p_window_seconds int
)
RETURNS TABLE (allowed bool, retry_after_seconds int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_window_start   timestamptz;
    v_count          int;
    v_window_end     timestamptz;
    v_now            timestamptz := now();
BEGIN
    -- Truncate current time to the nearest window boundary
    v_window_start := to_timestamp(
        floor(extract(epoch FROM v_now) / p_window_seconds) * p_window_seconds
    );
    v_window_end := v_window_start + (p_window_seconds * interval '1 second');

    -- Atomic upsert: insert a new bucket or increment existing count
    INSERT INTO rate_limit_buckets (user_id, bucket_key, window_start, count)
    VALUES (p_user_id, p_bucket_key, v_window_start, 1)
    ON CONFLICT (user_id, bucket_key, window_start)
    DO UPDATE SET count = rate_limit_buckets.count + 1
    RETURNING rate_limit_buckets.count INTO v_count;

    IF v_count <= p_max THEN
        RETURN QUERY SELECT true, 0;
    ELSE
        RETURN QUERY SELECT false, GREATEST(0, EXTRACT(EPOCH FROM (v_window_end - v_now))::int);
    END IF;
END;
$$;

-- ── Cleanup cron (requires pg_cron extension) ─────────────────────────────────
-- Deletes rows older than 24 hours hourly. If pg_cron is not enabled on this
-- project, this block is skipped and the table is bounded at ~30 rows/hr/user
-- (acceptable for v1). See Builder Questions in TICKET-053 build log.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        PERFORM cron.schedule(
            'rate-limit-cleanup',
            '0 * * * *',
            $$DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '24 hours'$$
        );
    END IF;
END
$$;
