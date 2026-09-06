-- Reference migration for the authorization pattern's Postgres/Drizzle adapter (Model 2).
--
-- This library never runs migrations against a consumer's database (see
-- MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or re-export the tables from `schema.ts` and let
-- `drizzle-kit generate` produce the equivalent.
--
-- Keep in sync with `schema.ts`. Requires PostgreSQL 15+ (for NULLS NOT
-- DISTINCT on commons_authz_user_role).

CREATE TABLE IF NOT EXISTS "commons_authz_role" (
  "id"          text PRIMARY KEY,
  "description" text,
  "grants_all"  boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "commons_authz_action" (
  "name"        text PRIMARY KEY,
  "description" text
);

CREATE TABLE IF NOT EXISTS "commons_authz_role_permission" (
  "role_id" text NOT NULL REFERENCES "commons_authz_role"("id")   ON DELETE CASCADE,
  "action"  text NOT NULL REFERENCES "commons_authz_action"("name") ON DELETE RESTRICT,
  PRIMARY KEY ("role_id", "action")
);

CREATE TABLE IF NOT EXISTS "commons_authz_user_role" (
  "user_id"    text NOT NULL,
  "tenant_id"  text,
  "role_id"    text NOT NULL REFERENCES "commons_authz_role"("id") ON DELETE CASCADE,
  "granted_at" timestamptz NOT NULL DEFAULT now(),
  "granted_by" text,
  CONSTRAINT "commons_authz_user_role_uq" UNIQUE NULLS NOT DISTINCT ("user_id", "tenant_id", "role_id")
);

CREATE INDEX IF NOT EXISTS "commons_authz_user_role_lookup"
  ON "commons_authz_user_role" ("user_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "commons_authz_delegation" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "granter_id" text NOT NULL,
  "grantee_id" text NOT NULL,
  "tenant_id"  text NOT NULL,
  "actions"    text[] NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "revoked_by" text,
  "reason"     text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "commons_authz_delegation_grantee"
  ON "commons_authz_delegation" ("grantee_id", "tenant_id");

-- The role catalog and role→permission rows are platform-owned. To enforce
-- "role definition is platform-admin only" at the database, REVOKE insert,
-- update, delete ON commons_authz_role, commons_authz_role_permission, commons_authz_action from the
-- ordinary application role and grant them only to a migration/admin role.
