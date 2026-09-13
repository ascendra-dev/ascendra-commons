import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';
import {
  AUDIT_EVENT_READER,
  diffFields,
  type ActorActivitySummary,
  type AuditCoverageEntry,
  type AuditEventDetail,
  type AuditEventReader,
  type AuditQuery,
  type AuditQueryResult,
  type AuditStats,
} from '../audit-logging.core';
import { AUDIT_API_OPTIONS } from './tokens';
import type { AuditApiOptions } from './audit-api.options';
import type {
  AuditActorActivityQueryDto,
  AuditCoverageRequestDto,
  AuditEventsQueryDto,
  AuditStatsQueryDto,
} from './dto/audit-api.dto';

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

  /**
   * One record, plus its field-level diff — the Record Detail screen. Same
   * tenant-scoping rule as `find()`: a non-platform actor can only fetch a
   * record in their own tenant. A cross-tenant id (or an id that doesn't
   * exist at all) 404s either way, so existence is never leaked.
   */
  async findOne(actor: Actor, id: string): Promise<AuditEventDetail> {
    const tenantId = await this.resolveTenantScope(actor);
    const event = await this.reader.findOne(id, tenantId);
    if (!event) throw new NotFoundException(`audit record '${id}' not found`);
    return { ...event, diff: diffFields(event.before, event.after) };
  }

  /** The Actor Activity screen. Same tenant-scoping rule as `find()`. */
  async actorActivity(actor: Actor, actorFilter: string, dto: AuditActorActivityQueryDto): Promise<ActorActivitySummary> {
    const tenantId = await this.resolveTenantScope(actor);
    return this.reader.summarizeActor(actorFilter, {
      ...(tenantId !== undefined ? { tenantId } : {}),
      occurredAfter: dto.occurredAfter ? new Date(dto.occurredAfter) : undefined,
      occurredBefore: dto.occurredBefore ? new Date(dto.occurredBefore) : undefined,
    });
  }

  /**
   * The Overview screen. A non-platform actor's figures are forced to their
   * own tenant; a platform admin sees every tenant by default and may filter
   * to one via `tenantId` (or `'null'` for platform-level rows only) — same
   * convention as `find()`'s `tenantId` param.
   */
  async stats(actor: Actor, dto: AuditStatsQueryDto): Promise<AuditStats> {
    if (await this.options.isPlatformAdmin(actor)) {
      const tenantId = dto.tenantId !== undefined ? (dto.tenantId === 'null' ? null : dto.tenantId) : undefined;
      return this.reader.stats(dto.window ?? '30d', tenantId);
    }
    if (actor.tenantId === null) {
      throw new ForbiddenException('a tenant-scoped actor cannot read the audit log without a tenant');
    }
    return this.reader.stats(dto.window ?? '30d', actor.tenantId);
  }

  /** The Coverage & Gaps screen — a per-request comparison, no catalog table. */
  async coverage(actor: Actor, dto: AuditCoverageRequestDto): Promise<AuditCoverageEntry[]> {
    const tenantId = await this.resolveTenantScope(actor);
    return this.reader.countByDeclared({
      entityTypes: dto.entityTypes ?? [],
      actions: dto.actions ?? [],
      ...(tenantId !== undefined ? { tenantId } : {}),
    });
  }

  /** `undefined` → platform admin, unrestricted. Throws for a tenant-scoped actor with no tenant. */
  private async resolveTenantScope(actor: Actor): Promise<string | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return undefined;
    if (actor.tenantId === null) {
      throw new ForbiddenException('a tenant-scoped actor cannot read the audit log without a tenant');
    }
    return actor.tenantId;
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
