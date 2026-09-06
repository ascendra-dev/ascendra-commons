import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { RequiresAction } from '../../../authorization/authorization.core';
import { NOTIFICATION_ACTIONS } from '../notification-api.options';
import { NotificationObservabilityApiService } from './notification-observability-api.service';
import type { NotificationChannel } from '../../notification.core';
import type { DeliveryRecord } from '../../notification.core.database';

/**
 * Read endpoints for a "did it send / is the config complete" admin screen. All
 * gated on `notification.view`. Requires `AuthorizationGuard` wired globally as
 * `APP_GUARD` (see `authorization.core`'s README).
 */
@Controller('notifications')
export class NotificationObservabilityController {
  constructor(
    @Inject(NotificationObservabilityApiService) private readonly service: NotificationObservabilityApiService,
  ) {}

  @Get('deliveries')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  deliveries(
    @Query('notificationType') notificationType?: string,
    @Query('channel') channel?: NotificationChannel,
    @Query('tenantId') tenantId?: string,
    @Query('recipientRef') recipientRef?: string,
    @Query('status') status?: DeliveryRecord['status'],
    @Query('correlationId') correlationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.getDeliveryHistory({
      notificationType,
      channel,
      tenantId,
      recipientRef,
      status,
      correlationId,
      since,
      until,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('deliveries/:id/content')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  deliveryContent(@Param('id') id: string) {
    return this.service.getDeliveryContent(id);
  }

  @Get('config/coverage-gaps')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  coverageGaps() {
    return this.service.coverageGaps();
  }
}
