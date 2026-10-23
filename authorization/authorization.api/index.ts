export { AuthorizationApiModule } from './authorization-api.module';
export type { AuthzApiModuleConfig } from './authz-api.options';
export { AUTHZ_ACTIONS } from './authz-api.options';

export { CurrentActor } from './current-actor.decorator';

export type { AuthzAuditEmitter, AuthzAuditEvent } from './authz-audit.port';
export { NoopAuthzAuditEmitter } from './authz-audit.port';
export { AUTHZ_AUDIT_EMITTER, AUTHZ_API_OPTIONS } from './tokens';

export { AuthzAccessScope } from './shared/access-scope';
export type { AssignableRoleView, BulkAssignResult } from './admin/authz-admin-api.service';

export type {
  AssignRoleBody,
  BulkAssignBody,
  RevokeRoleQuery,
  SetActionDescriptionBody,
  CreateDelegationBody,
  AssignmentListQuery,
  DelegationListQuery,
  ExplainAccessQuery,
  WhoCanQuery,
} from './dto/authz-api.dto';
