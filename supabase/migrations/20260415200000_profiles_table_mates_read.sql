-- Allow authenticated users to read profiles of members who share a table with them.
-- The existing "profiles self access" policy only allows auth.uid() = user_id,
-- which blocks profile lookups for fellow table members in joins (e.g. filter chips,
-- participant names on cards).

CREATE POLICY "profiles read table mates"
ON "public"."profiles"
FOR SELECT
USING (
  -- Own profile is already covered by "profiles self access",
  -- but include it here for completeness so this policy alone
  -- is sufficient for the table-members query.
  "user_id" = auth.uid()
  OR
  EXISTS (
    SELECT 1
    FROM public.table_members my
    JOIN public.table_members theirs
      ON my.table_id = theirs.table_id
    WHERE my.member_id = auth.uid()
      AND theirs.member_id = profiles.user_id
  )
);
