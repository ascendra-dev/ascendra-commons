import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../authorization.core';
import {
  AUTHZ_DELEGATION_SERVICE,
  type DelegationRecord,
  type DelegationService,
} from '../../authorization.core.permission-table';
import { AUTHZ_API_OPTIONS, AUTHZ_AUDIT_EMITTER } from '../tokens';
import type { AuthzApiOptions } from '../authz-api.options';
import type { AuthzAuditEmitter } from '../authz-audit.port';
import type { CreateDelegationBody } from '../dto/authz-api.dto';

/**
 * Delegation endpoints, actor-scoped: the granter is always the request actor,
 * the tenant is always the actor's tenant, and audit is emitted around each
 * mutation. The snapshot / expiry-cap / chain-block rules are enforced by
 * `DelegationService` underneath.
 */
@Injectable()
export class AuthzDelegationApiService {
  constructor(
    @Inject(AUTHZ_DELEGATION_SERVICE) private readonly delegation: DelegationService,
    @Inject(AUTHZ_API_OPTIONS) private readonly options: AuthzApiOptions,
    @Inject(AUTHZ_AUDIT_EMITTER) private readonly audit: AuthzAuditEmitter,
  ) {}

  async create(actor: Actor, body: CreateDelegationBody): Promise<DelegationRecord> {
    if (actor.tenantId === null) {
      throw new ForbiddenException('delegation requires a tenant-scoped actor');
    }
    if (body.tenantId !== undefined && body.tenantId !== actor.tenantId) {
      throw new ForbiddenException('cannot delegate outside your own tenant');
    }
    const expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('expiresAt must be an ISO-8601 date string');
    }

    const record = await this.delegation.delegate({
      granterId: actor.id,
      granteeId: body.granteeId,
      tenantId: actor.tenantId,
      actions: body.actions,
      expiresAt,
      reason: body.reason,
      createdBy: actor.id,
    });
    await this.audit.record({
      action: 'authz.delegation_granted',
      actorId: actor.id,
      tenantId: actor.tenantId,
      entityType: 'delegation',
      entityId: record.id,
      after: { granteeId: record.granteeId, actions: record.actions, expiresAt: record.expiresAt },
    });
    return record;
  }

  /**
   * Tenant ceiling: a non-platform actor may only revoke a delegation that
   * belongs to their own tenant — mirroring `AuthzAdminApiService`'s
   * `resolveTargetTenant`. A delegation id that doesn't exist (or is already
   * revoked) is left to the repository's own idempotent no-op.
   */
  async revoke(actor: Actor, id: string): Promise<void> {
    const delegation = await this.delegation.getById(id);
    if (delegation && delegation.tenantId !== actor.tenantId && !(await this.options.isPlatformAdmin(actor))) {
      throw new ForbiddenException('cannot revoke a delegation outside your own tenant');
    }

    await this.delegation.revokeDelegation(id, actor.id);
    await this.audit.record({
      action: 'authz.delegation_revoked',
      actorId: actor.id,
      tenantId: actor.tenantId,
      entityType: 'delegation',
      entityId: id,
    });
  }

  listMine(actor: Actor) {
    return this.delegation.listDelegations(actor);
  }
}
