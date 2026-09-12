import { Inject, Injectable } from '@nestjs/common';
import {
  AUTHZ_OBSERVABILITY_PORT,
  type AuthzObservabilityPort,
} from '../../authorization.core.permission-table';
import { AUTHZ_API_OPTIONS } from '../tokens';
import type { AuthzApiOptions } from '../authz-api.options';
import type { AssignmentListQuery, DelegationListQuery, ExplainAccessQuery } from '../dto/authz-api.dto';

/**
 * Thin orchestration over `AuthzObservabilityPort` — the reads are already
 * UI-shaped, so this is mostly passthrough plus supplying the app's action
 * catalog to `actionCatalogHealth`. No mutation, no actor-scoped rules (reads
 * are gated by `@RequiresAction('authz.view')` at the controller).
 */
@Injectable()
export class AuthzObservabilityApiService {
  constructor(
    @Inject(AUTHZ_OBSERVABILITY_PORT) private readonly port: AuthzObservabilityPort,
    @Inject(AUTHZ_API_OPTIONS) private readonly options: AuthzApiOptions,
  ) {}

  listRoles() {
    return this.port.listRoles();
  }

  listAssignments(query: AssignmentListQuery) {
    return this.port.listUserRoleAssignments(query);
  }

  listDelegations(query: DelegationListQuery) {
    return this.port.listDelegations(query);
  }

  explainAccess(query: ExplainAccessQuery) {
    return this.port.explainAccess(query.userId, query.tenantId, query.action);
  }

  actionCatalogHealth() {
    return this.port.actionCatalogHealth(this.options.actionCatalog);
  }
}
