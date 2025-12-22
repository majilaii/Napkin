-- Migration: Create table_invitations table
-- This table manages invitations for users to join tables

CREATE TABLE IF NOT EXISTS "public"."table_invitations" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "table_id" uuid NOT NULL,
    "invited_user_id" uuid NOT NULL,
    "invited_by" uuid NOT NULL,
    "status" text DEFAULT 'pending'::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "table_invitations_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text])))
);

ALTER TABLE "public"."table_invitations" OWNER TO "postgres";

-- Primary key
ALTER TABLE ONLY "public"."table_invitations"
    ADD CONSTRAINT "table_invitations_pkey" PRIMARY KEY ("id");

-- Unique constraint to prevent duplicate invitations
ALTER TABLE ONLY "public"."table_invitations"
    ADD CONSTRAINT "table_invitations_unique_pending" UNIQUE ("table_id", "invited_user_id", "status");

-- Foreign keys
ALTER TABLE ONLY "public"."table_invitations"
    ADD CONSTRAINT "table_invitations_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."table_invitations"
    ADD CONSTRAINT "table_invitations_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."table_invitations"
    ADD CONSTRAINT "table_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE "public"."table_invitations" ENABLE ROW LEVEL SECURITY;

-- Policies

-- Members of a table can view invitations for that table
CREATE POLICY "Members can view table invitations"
ON "public"."table_invitations"
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.table_members tm
        WHERE tm.table_id = table_invitations.table_id
        AND tm.member_id = auth.uid()
    )
    OR invited_user_id = auth.uid()
);

-- Admins can create invitations
CREATE POLICY "Admins can create invitations"
ON "public"."table_invitations"
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.table_members tm
        WHERE tm.table_id = table_invitations.table_id
        AND tm.member_id = auth.uid()
        AND tm.role = 'admin'
    )
    AND invited_by = auth.uid()
);

-- Invited users can update their own invitation (to accept/decline)
CREATE POLICY "Invited users can respond to invitations"
ON "public"."table_invitations"
FOR UPDATE
TO authenticated
USING (invited_user_id = auth.uid())
WITH CHECK (invited_user_id = auth.uid());

-- Admins can delete invitations
CREATE POLICY "Admins can delete invitations"
ON "public"."table_invitations"
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.table_members tm
        WHERE tm.table_id = table_invitations.table_id
        AND tm.member_id = auth.uid()
        AND tm.role = 'admin'
    )
);

-- Grants
GRANT ALL ON TABLE "public"."table_invitations" TO "anon";
GRANT ALL ON TABLE "public"."table_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."table_invitations" TO "service_role";
