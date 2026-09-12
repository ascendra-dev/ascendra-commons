// Schema — re-export from your own schema barrel so drizzle-kit picks it up
export {
  authzRole,
  authzAction,
  authzRolePermission,
  authzUserRole,
  authzDelegation,
} from './persistence/schema';
export type { SqlExecutor } from './persistence/sql-executor';

// Seed helpers — run once at deploy time / in a migration
export { syncActions } from './seed/sync-actions';
export { seedRolesFromPersonaMap } from './seed/seed-roles-from-persona-map';

// Wiring
export { PostgresPermissionTableModule } from './postgres-permission-table.module';
export type { PostgresPermissionTableModuleConfig } from './postgres-permission-table.module';
export { PostgresAuthzAdminModule } from './postgres-authz-admin.module';
export type { PostgresAuthzAdminModuleConfig } from './postgres-authz-admin.module';
export { AUTHZ_SQL_EXECUTOR } from './tokens';
