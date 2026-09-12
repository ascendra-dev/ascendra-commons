import { Inject, Injectable } from '@nestjs/common';
import {
  WEBHOOK_OBSERVABILITY_PORT,
  type WebhookEventPage,
  type WebhookObservabilityPort,
  type WebhookOutcomeCount,
} from '../payment-gateway-adapter.core';
import type { WebhookEventQueryDto } from './dto/payment-gateway-api.dto';

/**
 * Thin orchestration over `WebhookObservabilityPort`. No tenant scoping —
 * a webhook event is scoped by gateway/application, not by tenant; gate
 * `payment-gateway.view` to an ops/security persona instead. Date params are
 * parsed here. No mutation surface — events are write-once, recorded only by
 * a `WebhookEventLog` implementation.
 */
@Injectable()
export class PaymentGatewayApiService {
  constructor(@Inject(WEBHOOK_OBSERVABILITY_PORT) private readonly observability: WebhookObservabilityPort) {}

  listEvents(query: WebhookEventQueryDto): Promise<WebhookEventPage> {
    return this.observability.listEvents({
      gateway: query.gateway,
      outcome: query.outcome,
      correlationId: query.correlationId,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  getTrace(correlationId: string, query: WebhookEventQueryDto): Promise<WebhookEventPage> {
    return this.listEvents({ ...query, correlationId });
  }

  outcomeCounts(since?: string): Promise<WebhookOutcomeCount[]> {
    return this.observability.outcomeCounts(since ? new Date(since) : undefined);
  }
}
