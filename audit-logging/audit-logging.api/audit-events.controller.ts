import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { CurrentActor, RequiresAction, type Actor } from '../../authorization/authorization.core';
import { AUDIT_ACTIONS } from './audit-api.options';
import { AuditEventsApiService } from './audit-events-api.service';

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
  events(
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
    return this.service.find(actor, {
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
  }

  @Get('entities/:type/:id/history')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  entityHistory(
    @CurrentActor() actor: Actor,
    @Param('type') type: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.entityHistory(actor, type, id, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('trace/:correlationId')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  trace(
    @CurrentActor() actor: Actor,
    @Param('correlationId') correlationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.trace(actor, correlationId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }
}
