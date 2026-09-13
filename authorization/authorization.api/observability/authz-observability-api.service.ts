import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AUTHZ_OBSERVABILITY_PORT,
  type AuthzObservabilityPort,
  type RoleDetail,
} from '../../authorization.core.permission-table';
import { AUTHZ_API_OPTIONS } from '../tokens';
import type { AuthzApiOptions } from '../authz-api.options';
import type {
  AssignmentListQuery,
  DelegationListQuery,
  ExplainAccessQuery,
  WhoCanQuery,
} from '../dto/authz-api.dto';

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

  /** Fetches one role plus its holder count. Throws `NotFoundException` (404) if the role doesn't exist. */
  async getRole(id: string): Promise<RoleDetail> {
    const role = await this.port.getRole(id);
    if (!role) throw new NotFoundException(`No role '${id}' in the role catalog.`);
    const holderCount = await this.port.countHolders(id);
    return { ...role, holderCount };
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

  async whoCan(query: WhoCanQuery) {
    if (!query.action) throw new BadRequestException('action is required');
    return this.port.whoCan(query.action, query.tenantId);
  }
}
