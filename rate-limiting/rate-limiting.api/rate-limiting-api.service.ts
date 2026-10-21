import { Inject, Injectable } from '@nestjs/common';
import {
  RATE_LIMIT_OBSERVABILITY_PORT,
  type IdentifierRejectionCount,
  type RateLimitObservabilityPort,
  type RejectionPage,
  type RouteRejectionCount,
} from '../rate-limiting.core';
import type { RejectionQueryDto, TopIdentifiersQueryDto } from './dto/rate-limiting-api.dto';

/**
 * Thin orchestration over `RateLimitObservabilityPort`. No tenant scoping —
 * a rejected, unauthenticated request has no tenant to scope by; gate
 * `rate-limit.view` to an ops/security persona instead. Date params are
 * parsed here. No mutation surface — rejections are write-once, recorded
 * only by `RecordingThrottlerGuard`.
 */
@Injectable()
export class RateLimitingApiService {
  constructor(@Inject(RATE_LIMIT_OBSERVABILITY_PORT) private readonly observability: RateLimitObservabilityPort) {}

  listRejections(query: RejectionQueryDto): Promise<RejectionPage> {
    return this.observability.listRejections({
      route: query.route,
      identifier: query.identifier,
      correlationId: query.correlationId,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  getTrace(correlationId: string, query: RejectionQueryDto): Promise<RejectionPage> {
    return this.listRejections({ ...query, correlationId });
  }

  rejectionCatalog(since?: string): Promise<RouteRejectionCount[]> {
    return this.observability.rejectionCatalog(since ? new Date(since) : undefined);
  }

  topIdentifiers(query: TopIdentifiersQueryDto): Promise<IdentifierRejectionCount[]> {
    return this.observability.topIdentifiers({
      since: query.since ? new Date(query.since) : undefined,
      route: query.route,
      limit: query.limit,
    });
  }
}
