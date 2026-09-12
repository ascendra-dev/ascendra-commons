import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  NOTIFICATION_OBSERVABILITY_PORT,
  type NotificationObservabilityPort,
} from '../../notification.core.database';
import type { DeliveryHistoryQueryDto } from '../dto/notification-api.dto';

/**
 * Thin orchestration over `NotificationObservabilityPort` — the reads are
 * already UI-shaped, so this is passthrough plus parsing date-string query
 * params and turning a missing content row into a 404.
 */
@Injectable()
export class NotificationObservabilityApiService {
  constructor(@Inject(NOTIFICATION_OBSERVABILITY_PORT) private readonly port: NotificationObservabilityPort) {}

  getDeliveryHistory(query: DeliveryHistoryQueryDto) {
    return this.port.getDeliveryHistory({
      notificationType: query.notificationType,
      channel: query.channel,
      tenantId: query.tenantId,
      recipientRef: query.recipientRef,
      status: query.status,
      correlationId: query.correlationId,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  async getDeliveryContent(id: string) {
    const record = await this.port.getDeliveryContent(id);
    if (!record) throw new NotFoundException('no stored content for that delivery');
    return record;
  }

  coverageGaps() {
    return this.port.configCoverageGaps();
  }
}
