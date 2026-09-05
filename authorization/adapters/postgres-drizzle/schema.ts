import { boolean, index, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * The reference `authz_*` schema — one concrete Postgres/Drizzle shape of the
 * database-backed authorization model (Model 2). Source of truth for the
 * columns; `authorization.migration.sql` in this folder is the hand-kept DDL
 * form of the same tables — keep the two in sync.
 *
 * A consuming project on Postgres/Drizzle can re-export these from its own
 * schema barrel so `drizzle-kit generate` produces the migration; a project on
 * another stack ignores this folder and provides its own `Authorizer`.
 *
 * Tables are `authz_`-prefixed on purpose — `role` / `user_role` are names a
 * vertical is likely to want for its own tables.
 */

/** The role catalog — platform-owned, small, not tenant-editable. */
export const authzRole = pgTable('authz_role', {
  /** Stable slug (`'issuer'`, `'issuer_owner'`), not a uuid — referenced from seeds and the admin matrix. */
  id: text('id').primaryKey(),
  description: text('description'),
  /** The `'*'` wildcard equivalent — this role grants every action, no `authz_role_permission` rows needed. */
  grantsAll: boolean('grants_all').notNull().default(false),
});

/**
 * The action catalog. `name` is the key from the app's `Actions` const, kept in
 * sync by `syncActions()`. `description` ships empty and is filled in later
 * through the admin UI — never set by the sync.
 */
export const authzAction = pgTable('authz_action', {
  name: text('name').primaryKey(),
  description: text('description'),
});

/** Which actions each role grants. Ignored when the role's `grants_all` is true. */
export const authzRolePermission = pgTable(
  'authz_role_permission',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => authzRole.id, { onDelete: 'cascade' }),
    /** FK to the action catalog — `onDelete: 'restrict'` forces deliberate cleanup before an action can be removed. */
    action: text('action')
      .notNull()
      .references(() => authzAction.name, { onDelete: 'restrict' }),
  },
  (table) => ({ pk: primaryKey({ columns: [table.roleId, table.action] }) }),
);

/**
 * Role assignments. Tenant-scoped: the same user can hold different roles in
 * different tenants. `tenant_id` NULL = the role applies in every tenant / in a
 * no-tenant context (a platform admin).
 */
export const authzUserRole = pgTable(
  'authz_user_role',
  {
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id'),
    roleId: text('role_id')
      .notNull()
      .references(() => authzRole.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    grantedBy: text('granted_by'),
  },
  (table) => ({
    // NULLS NOT DISTINCT so (user, NULL, role) can't be double-inserted (Postgres 15+).
    uq: unique('authz_user_role_uq').on(table.userId, table.tenantId, table.roleId).nullsNotDistinct(),
    lookup: index('authz_user_role_lookup').on(table.userId, table.tenantId),
  }),
);

/**
 * Delegations — a user granting a subset of their own (role-derived) actions to
 * another user, within one tenant. Snapshot model: `actions` is fixed at grant
 * time and stays valid until `expires_at` (mandatory) or `revoked_at`. See the
 * adapter README for what the snapshot model defers.
 */
export const authzDelegation = pgTable(
  'authz_delegation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    granterId: text('granter_id').notNull(),
    granteeId: text('grantee_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    actions: text('actions').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedBy: text('revoked_by'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdBy: text('created_by').notNull(),
  },
  (table) => ({ byGrantee: index('authz_delegation_grantee').on(table.granteeId, table.tenantId) }),
);
