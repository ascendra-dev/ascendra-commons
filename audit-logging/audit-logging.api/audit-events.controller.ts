import { Body, Controller, Get, Header, Inject, Param, Post, Query } from '@nestjs/common';
import { CurrentActor, RequiresAction, type Actor } from '../../authorization/authorization.core';
import type { AuditQueryResult } from '../audit-logging.core';
import { AUDIT_ACTIONS } from './audit-api.options';
import { renderAuditEventsCsv } from './audit-events-csv';
import { AuditEventsApiService } from './audit-events-api.service';
import type { AuditCoverageRequestDto } from './dto/audit-api.dto';

/**
 * api-contract.md Rule 4's cursor-based list shape. The core port's `{ records, nextCursor }`
 * stays a domain type (the postgres reader and the CSV endpoint use it as-is) — the wire
 * shape is this controller's concern. An absent `nextCursor` serializes as `meta: {}`.
 */
function toCursorList({ records, nextCursor }: AuditQueryResult) {
  return { data: records, meta: { nextCursor } };
}

/**
 * Read endpoints for a compliance / ops audit screen. All gated on `audit.view`.
 * A non-platform actor's reads are auto-scoped to their own tenant (see
 * `AuditEventsApiService`). Requires `AuthorizationGuard` wired globally as
 * `APP_GUARD` (see `authorization.core`'s README).
 */
@Controller('audit')
export class AuditEventsController {
  constructor(@Inject(AuditEventsApiService) private readonly service: AuditEventsApiService) {}

  @Get('events')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  async events(
    @CurrentActor() actor: Actor,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('actor') actorFilter?: string,
    @Query('action') action?: string,
    @Query('correlationId') correlationId?: string,
    @Query('occurredAfter') occurredAfter?: string,
    @Query('occurredBefore') occurredBefore?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return toCursorList(await this.service.find(actor, {
      entityType,
      entityId,
      tenantId,
      actor: actorFilter,
      action,
      correlationId,
      occurredAfter,
      occurredBefore,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    }));
  }

  @Get('events.csv')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="audit-events.csv"')
  async eventsCsv(
    @CurrentActor() actor: Actor,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('actor') actorFilter?: string,
    @Query('action') action?: string,
    @Query('correlationId') correlationId?: string,
    @Query('occurredAfter') occurredAfter?: string,
    @Query('occurredBefore') occurredBefore?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<string> {
    const { records } = await this.service.find(actor, {
      entityType,
      entityId,
      tenantId,
      actor: actorFilter,
      action,
      correlationId,
      occurredAfter,
      occurredBefore,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
    return renderAuditEventsCsv(records);
  }

  @Get('events/:id')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  event(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.findOne(actor, id);
  }

  @Get('actors/:actor/activity')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  actorActivity(
    @CurrentActor() actor: Actor,
    @Param('actor') actorFilter: string,
    @Query('occurredAfter') occurredAfter?: string,
    @Query('occurredBefore') occurredBefore?: string,
  ) {
    return this.service.actorActivity(actor, actorFilter, { occurredAfter, occurredBefore });
  }

  @Get('stats')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  stats(@CurrentActor() actor: Actor, @Query('window') window?: string, @Query('tenantId') tenantId?: string) {
    return this.service.stats(actor, { window, tenantId });
  }

  /** api-contract.md Rule 4's bounded bare-array case — the app's fixed vocabulary, never paginated. */
  @Get('catalog')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  catalog() {
    return this.service.catalog();
  }

  @Post('coverage')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  coverage(@CurrentActor() actor: Actor, @Body() body?: AuditCoverageRequestDto) {
    return this.service.coverage(actor, body);
  }

  @Get('entities/:type/:id/history')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  async entityHistory(
    @CurrentActor() actor: Actor,
    @Param('type') type: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return toCursorList(await this.service.entityHistory(actor, type, id, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    }));
  }

  @Get('trace/:correlationId')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  async trace(
    @CurrentActor() actor: Actor,
    @Param('correlationId') correlationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return toCursorList(await this.service.trace(actor, correlationId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    }));
  }
}
