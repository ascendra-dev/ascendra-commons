import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { RequiresAction } from '../../authorization/authorization.core';
import { DOMAIN_EVENTS_ACTIONS } from './domain-events-api.options';
import { DomainEventsApiService } from './domain-events-api.service';

/**
 * Read endpoints for an event-delivery admin screen: the delivery log, the
 * per-event catalog (aggregated from the delivery log), and the static
 * listener-wiring catalogue. All gated on `domain-events.view`. No tenant
 * scoping. Requires `AuthorizationGuard` wired globally as `APP_GUARD` (see
 * `authorization.core`'s README).
 */
@Controller('domain-events')
export class DomainEventsController {
  constructor(@Inject(DomainEventsApiService) private readonly service: DomainEventsApiService) {}

  @Get('deliveries')
  @RequiresAction(DOMAIN_EVENTS_ACTIONS.VIEW)
  deliveries(
    @Query('eventName') eventName?: string,
    @Query('method') method?: 'emit' | 'emitCritical',
    @Query('status') status?: 'delivered' | 'no_listeners' | 'dispatch_failed',
    @Query('correlationId') correlationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listDeliveries({
      eventName,
      method,
      status,
      correlationId,
      since,
      until,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('deliveries/trace/:correlationId')
  @RequiresAction(DOMAIN_EVENTS_ACTIONS.VIEW)
  trace(
    @Param('correlationId') correlationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.getTrace(correlationId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('deliveries/catalog')
  @RequiresAction(DOMAIN_EVENTS_ACTIONS.VIEW)
  deliveryCatalog() {
    return this.service.deliveryCatalog();
  }

  @Get('listener-catalog')
  @RequiresAction(DOMAIN_EVENTS_ACTIONS.VIEW)
  listenerCatalog() {
    return this.service.listListenerBindings();
  }
}
