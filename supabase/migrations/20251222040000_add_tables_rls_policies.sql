-- Drop existing policies if they exist (from the just-applied migration)
DROP POLICY IF EXISTS "Authenticated users can create tables" ON "public"."tables";
DROP POLICY IF EXISTS "Members can view their tables" ON "public"."tables";
DROP POLICY IF EXISTS "Owners can update their tables" ON "public"."tables";
DROP POLICY IF EXISTS "Owners can delete their tables" ON "public"."tables";
DROP POLICY IF EXISTS "Members can view table members" ON "public"."table_members";
DROP POLICY IF EXISTS "Allow insert for table creators and admins" ON "public"."table_members";
DROP POLICY IF EXISTS "Admins can update member roles" ON "public"."table_members";
DROP POLICY IF EXISTS "Members can leave, admins can remove" ON "public"."table_members";

-- =========================================
-- RLS policies for tables table
-- =========================================

-- Allow authenticated users to create tables (they become owner)
CREATE POLICY "Authenticated users can create tables"
ON "public"."tables"
FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid());

-- Allow members to view tables they belong to
CREATE POLICY "Members can view their tables"
ON "public"."tables"
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.table_members tm
        WHERE tm.table_id = tables.id
        AND tm.member_id = auth.uid()
    )
);

-- Allow owners to update their tables
CREATE POLICY "Owners can update their tables"
ON "public"."tables"
FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- Allow owners to delete their tables
CREATE POLICY "Owners can delete their tables"
ON "public"."tables"
FOR DELETE
TO authenticated
USING (owner_id = auth.uid());

-- =========================================
-- RLS policies for table_members table
-- (Avoiding infinite recursion)
-- =========================================

-- Allow members to view members of tables they belong to
-- Use a security definer function to avoid recursion
CREATE OR REPLACE FUNCTION public.is_table_member(p_table_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.table_members
        WHERE table_id = p_table_id
        AND member_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.is_table_admin(p_table_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.table_members
        WHERE table_id = p_table_id
        AND member_id = p_user_id
        AND role = 'admin'
    );
$$;

-- SELECT: Members can view other members in their tables
CREATE POLICY "Members can view table members"
ON "public"."table_members"
FOR SELECT
TO authenticated
USING (public.is_table_member(table_id, auth.uid()));

-- INSERT: Table owner can add the first member (themselves)
-- Admins can add other members via invitations
CREATE POLICY "Table owner or admin can add members"
ON "public"."table_members"
FOR INSERT
TO authenticated
WITH CHECK (
    -- User adding themselves AND they own the table
    (member_id = auth.uid() AND EXISTS (
        SELECT 1 FROM public.tables t
        WHERE t.id = table_id
        AND t.owner_id = auth.uid()
    ))
    OR
    -- Admin adding someone else (via invitation flow)
    public.is_table_admin(table_id, auth.uid())
);

-- UPDATE: Only admins can update member roles
CREATE POLICY "Admins can update member roles"
ON "public"."table_members"
FOR UPDATE
TO authenticated
USING (public.is_table_admin(table_id, auth.uid()));

-- DELETE: Members can remove themselves, admins can remove others
CREATE POLICY "Members can leave, admins can remove"
ON "public"."table_members"
FOR DELETE
TO authenticated
USING (
    member_id = auth.uid()
    OR public.is_table_admin(table_id, auth.uid())
);
