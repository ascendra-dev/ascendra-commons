import { Inject, Injectable } from '@nestjs/common';
import {
  EVENT_DELIVERY_OBSERVABILITY_PORT,
  EVENT_LISTENER_CATALOG_PORT,
  type DeliveryPage,
  type EventDeliveryCatalogEntry,
  type EventDeliveryObservabilityPort,
  type EventListenerCatalogEntry,
  type EventListenerCatalogPort,
} from '../domain-events.core';
import type { DeliveryQueryDto } from './dto/domain-events-api.dto';

/**
 * Thin orchestration over `EventDeliveryObservabilityPort` (the runtime
 * delivery log) and `EventListenerCatalogPort` (the static wiring map). No
 * tenant scoping — `domain-events` has no `tenantId`. Date params are parsed
 * here. No mutation surface — deliveries are write-once and the listener
 * catalogue is a live read of the running app; there is nothing to administer.
 */
@Injectable()
export class DomainEventsApiService {
  constructor(
    @Inject(EVENT_DELIVERY_OBSERVABILITY_PORT) private readonly deliveries: EventDeliveryObservabilityPort,
    @Inject(EVENT_LISTENER_CATALOG_PORT) private readonly listenerCatalog: EventListenerCatalogPort,
  ) {}

  listDeliveries(query: DeliveryQueryDto): Promise<DeliveryPage> {
    return this.deliveries.listDeliveries({
      eventName: query.eventName,
      method: query.method,
      status: query.status,
      correlationId: query.correlationId,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  getTrace(correlationId: string, query: DeliveryQueryDto): Promise<DeliveryPage> {
    return this.listDeliveries({ ...query, correlationId });
  }

  deliveryCatalog(): Promise<EventDeliveryCatalogEntry[]> {
    return this.deliveries.deliveryCatalog();
  }

  listListenerBindings(): Promise<EventListenerCatalogEntry[]> {
    return this.listenerCatalog.list();
  }
}
