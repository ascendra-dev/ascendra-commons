import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';
import { AUDIT_EVENT_READER, type AuditEventReader, type AuditQuery, type AuditQueryResult } from '../audit-logging.core';
import { AUDIT_API_OPTIONS } from './tokens';
import type { AuditApiOptions } from './audit-api.options';
import type { AuditEventsQueryDto } from './dto/audit-api.dto';

/**
 * Reads audit records for a compliance/ops screen, over `AuditEventReader`. The
 * one actor-scoped rule: a non-platform actor's query is **forced** to their own
 * `tenantId` — they can only see their own tenant's activity feed; a platform
 * admin sees everything (and may filter by any `tenantId`, or `null` for
 * platform-level rows). Date-string params are parsed here.
 */
@Injectable()
export class AuditEventsApiService {
  constructor(
    @Inject(AUDIT_EVENT_READER) private readonly reader: AuditEventReader,
    @Inject(AUDIT_API_OPTIONS) private readonly options: AuditApiOptions,
  ) {}

  find(actor: Actor, dto: AuditEventsQueryDto): Promise<AuditQueryResult> {
    return this.query(actor, this.baseQuery(dto));
  }

  entityHistory(actor: Actor, entityType: string, entityId: string, dto: AuditEventsQueryDto): Promise<AuditQueryResult> {
    return this.query(actor, { ...this.baseQuery(dto), entityType, entityId });
  }

  trace(actor: Actor, correlationId: string, dto: AuditEventsQueryDto): Promise<AuditQueryResult> {
    return this.query(actor, { ...this.baseQuery(dto), correlationId });
  }

  private async query(actor: Actor, query: AuditQuery): Promise<AuditQueryResult> {
    if (await this.options.isPlatformAdmin(actor)) {
      return this.reader.find(query);
    }
    if (actor.tenantId === null) {
      throw new ForbiddenException('a tenant-scoped actor cannot read the audit log without a tenant');
    }
    return this.reader.find({ ...query, tenantId: actor.tenantId });
  }

  private baseQuery(dto: AuditEventsQueryDto): AuditQuery {
    const query: AuditQuery = {
      entityType: dto.entityType,
      entityId: dto.entityId,
      actor: dto.actor,
      action: dto.action,
      correlationId: dto.correlationId,
      occurredAfter: dto.occurredAfter ? new Date(dto.occurredAfter) : undefined,
      occurredBefore: dto.occurredBefore ? new Date(dto.occurredBefore) : undefined,
      limit: dto.limit,
      cursor: dto.cursor,
    };
    // Only a platform admin ever reaches a tenantId filter (query() overwrites it otherwise).
    if (dto.tenantId !== undefined) query.tenantId = dto.tenantId === 'null' ? null : dto.tenantId;
    return query;
  }
}
