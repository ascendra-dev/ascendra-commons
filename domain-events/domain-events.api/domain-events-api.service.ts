import { Inject, Injectable } from '@nestjs/common';
import {
  EVENT_DELIVERY_OBSERVABILITY_PORT,
  EVENT_LISTENER_CATALOG_PORT,
  type DeliveryPage,
  type DeliveryStats,
  type EventDeliveryCatalogEntry,
  type EventDeliveryObservabilityPort,
  type EventListenerCatalogEntry,
  type EventListenerCatalogPort,
} from '../domain-events.core';
import type { DeliveryQueryDto } from './dto/domain-events-api.dto';

const WINDOW_PATTERN = /^(\d+)(h|d)$/;
const DEFAULT_WINDOW = '7d';

/**
 * Parses a `?window=` value like `'7d'` or `'24h'` into a `since` cutoff
 * relative to `now`. Falls back to `DEFAULT_WINDOW` for a missing or
 * malformed value rather than rejecting the request — an admin dashboard
 * favors a sane default over a 400.
 */
export function parseStatsWindow(window: string | undefined, now: Date = new Date()): Date {
  const match = WINDOW_PATTERN.exec(window ?? DEFAULT_WINDOW) ?? WINDOW_PATTERN.exec(DEFAULT_WINDOW)!;
  const amount = Number(match[1]);
  const unitMs = match[2] === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - amount * unitMs);
}

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
      order: query.order,
    });
  }

  /** A cross-module request/job timeline reads top-to-bottom chronologically — always ascending, regardless of the caller's `order`. */
  getTrace(correlationId: string, query: DeliveryQueryDto): Promise<DeliveryPage> {
    return this.listDeliveries({ ...query, correlationId, order: 'asc' });
  }

  deliveryCatalog(): Promise<EventDeliveryCatalogEntry[]> {
    return this.deliveries.deliveryCatalog();
  }

  /** `window` like `'7d'` or `'24h'`; defaults to `'7d'` — see `parseStatsWindow()`. */
  deliveryStats(window?: string): Promise<DeliveryStats> {
    return this.deliveries.deliveryStats(parseStatsWindow(window));
  }

  listListenerBindings(): Promise<EventListenerCatalogEntry[]> {
    return this.listenerCatalog.list();
  }
}
