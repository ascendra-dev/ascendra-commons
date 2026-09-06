export {
  authzRole,
  authzAction,
  authzRolePermission,
  authzUserRole,
  authzDelegation,
} from './schema';
export type { SqlExecutor } from './sql-executor';
export { PermissionLoader } from './permission-loader';
export type { ResolvedPermissions } from './permission-loader';
export { PostgresPermissionTableAuthorizer } from './postgres-permission-table-authorizer';
export {
  DelegationService,
  CannotDelegateError,
  InvalidDelegationExpiryError,
} from './delegation.service';
export type {
  DelegationOptions,
  CreateDelegationInput,
  DelegationRecord,
} from './delegation.service';
export { syncActions } from './sync-actions';
export { seedRolesFromPersonaMap } from './seed-roles-from-persona-map';
export {
  AuthorizationCacheMiddleware,
  runWithPermissionCache,
  memoizePermissionLookup,
} from './permission-cache';
export { PostgresAuthorizationModule } from './postgres-authorization.module';
export type { PostgresAuthorizationModuleConfig } from './postgres-authorization.module';
export { PostgresAuthzObservabilityService } from './authz-observability.service';
export { PostgresAuthzAdminService, RoleNotFoundError, ActionNotFoundError } from './authz-admin.service';
export type { AssignRoleInput, RevokeRoleInput } from './authz-admin.service';
export { PostgresAuthzAdminModule } from './postgres-authz-admin.module';
export type { PostgresAuthzAdminModuleConfig } from './postgres-authz-admin.module';
export type {
  RoleView,
  UserRoleAssignment,
  DelegationView,
  DelegationQuery,
  DelegationPage,
  AccessExplanation,
  ActionCatalogHealth,
} from './authz-admin.types';
export {
  AUTHZ_SQL_EXECUTOR,
  AUTHZ_DELEGATION_OPTIONS,
  AUTHZ_DELEGATION_SERVICE,
  POSTGRES_PERMISSION_TABLE_AUTHORIZER,
  POSTGRES_AUTHZ_OBSERVABILITY,
  POSTGRES_AUTHZ_ADMIN,
} from './tokens';
