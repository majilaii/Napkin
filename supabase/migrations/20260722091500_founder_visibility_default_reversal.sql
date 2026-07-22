-- Founder order 2026-07-22 (in-session, verbatim): "Everything is public by
-- default... unless you go to settings." Reverses the 2026-04-17 "logs default
-- private" doctrine. The composer + entry fn now default solo logs to
-- 'friends' (publicly eligible via is_entry_publicly_eligible: public account
-- + rating + >=20-char note; account-level privacy stays the blanket opt-out).
--
-- This migration backfills the FOUNDER'S OWN rows only (account jacky /
-- dcfce66a — 16 rows at authoring time) off the old silent 'private' default.
-- Other users' private rows are deliberately untouched: they were written
-- under the old default and flip only on an explicit founder order covering
-- them.
--
-- Replay-from-zero: a fresh DB has no such rows; this is a 0-row no-op there.

update public.entries
set visibility = 'friends'
where user_id = 'dcfce66a-28f2-4019-935a-f7421f42e59b'
  and visibility = 'private';
