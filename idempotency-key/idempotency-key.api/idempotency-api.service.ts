import { Inject, Injectable } from '@nestjs/common';
import {
  IDEMPOTENCY_OBSERVABILITY_PORT,
  type ClaimHealthSummary,
  type ClaimPage,
  type IdempotencyClaimRecord,
  type IdempotencyObservabilityPort,
} from '../idempotency-key.core';
import type { ClaimQueryDto } from './dto/idempotency-api.dto';

/**
 * Thin orchestration over `IdempotencyObservabilityPort`. No tenant scoping —
 * `scope` is opaque to this module (whatever the app's own
 * `IdempotencyScopeResolver` returns), so there is no safe generic way to
 * auto-restrict a caller to "their own" scope the way `audit-logging.api` does
 * for `tenantId`. Gate `idempotency.view` to an ops/support persona instead —
 * see the module README. Date params are parsed here. No mutation surface —
 * claims are written only by `IdempotencyStore`.
 */
@Injectable()
export class IdempotencyApiService {
  constructor(@Inject(IDEMPOTENCY_OBSERVABILITY_PORT) private readonly observability: IdempotencyObservabilityPort) {}

  getClaim(key: string, scope: string): Promise<IdempotencyClaimRecord | null> {
    return this.observability.getClaim(key, scope);
  }

  listClaims(query: ClaimQueryDto): Promise<ClaimPage> {
    return this.observability.listClaims({
      status: query.status,
      scope: query.scope,
      correlationId: query.correlationId,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  getTrace(correlationId: string, query: ClaimQueryDto): Promise<ClaimPage> {
    return this.listClaims({ ...query, correlationId });
  }

  claimHealthSummary(): Promise<ClaimHealthSummary> {
    return this.observability.claimHealthSummary();
  }
}
