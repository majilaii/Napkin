-- TICKET-086c: persist the fused perception text (caption + OCR + transcript)
-- that produced each extraction, so a bad real-world import can be exported as
-- an eval fixture (scripts/eval/extraction) instead of being unreproducible.
--
-- Blast radius: additive nullable column on a service-role-only cache table.
-- No RLS (service role only), no PostgREST embeds reference extraction_cache,
-- only resolve-url reads/writes it (writeExtractionCache gains the column in
-- the same release — deploy order: db push BEFORE functions deploy).
alter table public.extraction_cache add column if not exists raw_text text;
