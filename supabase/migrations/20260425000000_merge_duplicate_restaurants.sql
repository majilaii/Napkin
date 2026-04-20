-- Merge duplicate restaurant rows.
-- Keep the row with a Google Place ID (ChIJ...) external_id and reassign FKs.

-- ── Donia ──────────────────────────────────────────────────────────────────────
-- Keep: 39ece402-078a-47f5-a036-5e64094d5df0 (Google: ChIJTUoBsQAFdkgRNfxmFv7zQIU, 6 entries)
-- Delete: 8b331996-d6f3-484d-902e-9f60df593185 (manual, 0 entries)
-- Delete: 0c45215a-3ca7-4fc3-a378-075308b97757 (foursquare, 0 entries)

UPDATE entries SET restaurant_id = '39ece402-078a-47f5-a036-5e64094d5df0'
 WHERE restaurant_id IN ('8b331996-d6f3-484d-902e-9f60df593185', '0c45215a-3ca7-4fc3-a378-075308b97757');

UPDATE table_nights SET restaurant_id = '39ece402-078a-47f5-a036-5e64094d5df0'
 WHERE restaurant_id IN ('8b331996-d6f3-484d-902e-9f60df593185', '0c45215a-3ca7-4fc3-a378-075308b97757');

DELETE FROM restaurants WHERE id IN ('8b331996-d6f3-484d-902e-9f60df593185', '0c45215a-3ca7-4fc3-a378-075308b97757');

-- ── The Ritz London ────────────────────────────────────────────────────────────
-- Keep: d9a65479-2ac0-4fda-8022-f564ae4d2a6c (Google: ChIJV8gP0ykFdkgRFEAEHoE1YVk, 3 entries)
-- Delete: a0756d0a-23a9-4726-9c38-d10fd7f3d8a4 (foursquare, 0 entries)
-- Delete: 70ed9264-cb99-44e2-bbff-483260e734c0 (NULL external_id, 0 entries)

UPDATE entries SET restaurant_id = 'd9a65479-2ac0-4fda-8022-f564ae4d2a6c'
 WHERE restaurant_id IN ('a0756d0a-23a9-4726-9c38-d10fd7f3d8a4', '70ed9264-cb99-44e2-bbff-483260e734c0');

UPDATE table_nights SET restaurant_id = 'd9a65479-2ac0-4fda-8022-f564ae4d2a6c'
 WHERE restaurant_id IN ('a0756d0a-23a9-4726-9c38-d10fd7f3d8a4', '70ed9264-cb99-44e2-bbff-483260e734c0');

DELETE FROM restaurants WHERE id IN ('a0756d0a-23a9-4726-9c38-d10fd7f3d8a4', '70ed9264-cb99-44e2-bbff-483260e734c0');

-- ── Prevent future duplicates ──────────────────────────────────────────────────
-- Add a unique index on external_id (where not null) to prevent duplicate Google Place IDs
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_external_id_unique
  ON restaurants (external_id)
  WHERE external_id IS NOT NULL;
