-- Reference migration for the notification pattern's Postgres/Drizzle adapter (Model 2).
--
-- This library never runs migrations against a consumer's database (see
-- MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or re-export the tables from `schema.ts` and let
-- `drizzle-kit generate` produce the equivalent. Requires PostgreSQL 15+.
--
-- Keep in sync with `schema.ts`.

CREATE TABLE IF NOT EXISTS "notification_channel_route" (
  "notification_type" text NOT NULL,
  "tenant_id"         text,
  "channels"          text[] NOT NULL,
  CONSTRAINT "notification_channel_route_uq" UNIQUE NULLS NOT DISTINCT ("notification_type", "tenant_id")
);

CREATE TABLE IF NOT EXISTS "notification_template" (
  "channel"           text NOT NULL,
  "notification_type" text NOT NULL,
  "tenant_id"         text,
  "subject"           text,
  "body"              text NOT NULL,
  "is_html"           boolean NOT NULL DEFAULT false,
  CONSTRAINT "notification_template_uq" UNIQUE NULLS NOT DISTINCT ("channel", "notification_type", "tenant_id")
);

CREATE TABLE IF NOT EXISTS "notification_provider_credential" (
  "channel"   text NOT NULL,
  "tenant_id" text NOT NULL,
  "api_key"   text NOT NULL,
  "from"      text NOT NULL,
  "from_name" text,
  PRIMARY KEY ("channel", "tenant_id")
);

CREATE INDEX IF NOT EXISTS "notification_provider_credential_tenant"
  ON "notification_provider_credential" ("tenant_id");

-- `api_key` holds a live provider secret. Encrypt it at rest — Supabase Vault,
-- pgcrypto, or a decrypting view — or store a secret-manager reference and
-- resolve it in a PostgresNotificationConfig subclass. Also consider REVOKE
-- select ON notification_provider_credential from the ordinary read role.
