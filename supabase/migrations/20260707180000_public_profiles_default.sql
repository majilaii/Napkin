-- Public profiles by default (doctrine 2026-04-20, schema-level).
--
-- Until now the raw column default was 'private' and "public" was only ever
-- written by complete_onboarding (see 20260707173000_onboarding_v2.sql, which
-- deliberately left the default private). That left a footgun: any profile row
-- born outside the onboarding stack (backfill, admin insert, a future signup
-- path) silently defaulted private, contradicting the public-by-default
-- doctrine. This flips the schema default so "public" is the true default and
-- onboarding's explicit write becomes belt-and-suspenders, not the sole source.
--
-- Reverses "locked #2" from 20260707173000_onboarding_v2.sql.
--
-- Additive, replayable from zero, zero blast radius: changes only the column
-- DEFAULT. Existing rows are NOT touched — anyone who opted out in settings
-- (account_privacy = 'private') stays private. Opt-out is respected.

ALTER TABLE public.profiles
    ALTER COLUMN account_privacy SET DEFAULT 'public';
