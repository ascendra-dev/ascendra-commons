import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  NOTIFICATION_OBSERVABILITY_PORT,
  type NotificationObservabilityPort,
} from '../../notification.core.database';
import { NOTIFICATION_API_OPTIONS } from '../tokens';
import type { NotificationApiOptions } from '../notification-api.options';
import type { DeliveryHistoryQueryDto, DeliveryStatsQueryDto } from '../dto/notification-api.dto';

const DEFAULT_WINDOW = '7d';
const WINDOW_RE = /^(\d+)(h|d)$/;

/**
 * Thin orchestration over `NotificationObservabilityPort` — the reads are
 * already UI-shaped, so this is mostly passthrough plus parsing date-string
 * query params and turning a missing content row into a 404.
 *
 * **Tenant ceiling** — `getDeliveryHistory`, `getDelivery` and
 * `getDeliveryStats` all force `tenantId = actor.tenantId` for a non-platform
 * actor, ignoring whatever tenant the caller asked for; a platform admin's
 * request passes through unscoped. Without this, `query.tenantId` would be
 * forwarded to the port verbatim and any actor could read any tenant's
 * deliveries.
 */
@Injectable()
export class NotificationObservabilityApiService {
  constructor(
    @Inject(NOTIFICATION_OBSERVABILITY_PORT) private readonly port: NotificationObservabilityPort,
    @Inject(NOTIFICATION_API_OPTIONS) private readonly options: NotificationApiOptions,
  ) {}

  async getDeliveryHistory(actor: Actor, query: DeliveryHistoryQueryDto) {
    const tenantId = await this.resolveTenantFilter(actor, query.tenantId);
    return this.port.getDeliveryHistory({
      notificationType: query.notificationType,
      channel: query.channel,
      tenantId,
      recipientRef: query.recipientRef,
      status: query.status,
      correlationId: query.correlationId,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /** 404s (rather than 403) when the row exists but belongs to another tenant — doesn't leak existence. */
  async getDelivery(actor: Actor, id: string) {
    const record = await this.port.getDelivery(id);
    if (!record) throw new NotFoundException('no such delivery');
    if (!(await this.options.isPlatformAdmin(actor)) && record.tenantId !== actor.tenantId) {
      throw new NotFoundException('no such delivery');
    }
    return record;
  }

  async getDeliveryContent(id: string) {
    const record = await this.port.getDeliveryContent(id);
    if (!record) throw new NotFoundException('no stored content for that delivery');
    return record;
  }

  coverageGaps() {
    return this.port.configCoverageGaps();
  }

  async getDeliveryStats(actor: Actor, query: DeliveryStatsQueryDto) {
    const tenantId = await this.resolveTenantFilter(actor, query.tenantId);
    const { since, until } = resolveWindow(query.window);
    return this.port.getDeliveryStats({ tenantId, since, until });
  }

  /** Non-platform actor → forced to their own tenant, regardless of what was requested. */
  private async resolveTenantFilter(actor: Actor, requested?: string): Promise<string | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return requested;
    return actor.tenantId ?? undefined;
  }
}

function resolveWindow(window?: string): { since: Date; until: Date } {
  const until = new Date();
  const match = WINDOW_RE.exec(window ?? DEFAULT_WINDOW);
  const amount = match ? Number(match[1]) : 7;
  const unit = match?.[2] ?? 'd';
  const ms = amount * (unit === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
  return { since: new Date(until.getTime() - ms), until };
}
