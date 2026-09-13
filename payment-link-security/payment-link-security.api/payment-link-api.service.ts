import { Inject, Injectable } from '@nestjs/common';
import {
  TOKEN_RESOLUTION_OBSERVABILITY_PORT,
  type ResolutionOutcomeCount,
  type ResolutionPage,
  type TokenResolutionObservabilityPort,
} from '../payment-link-security.core';
import type { ResolutionQueryDto } from './dto/payment-link-api.dto';

/**
 * Thin orchestration over `TokenResolutionObservabilityPort`. No tenant
 * scoping — a resolution attempt happens *before* any identity is
 * established (that's the entire point of `resolve()`), so there is no
 * tenant to scope by; gate `payment-link.view` to an ops/security persona
 * instead. Date params are parsed here. No mutation surface — resolution
 * attempts are write-once, recorded only by a `PaymentLinkTokenService`
 * implementation.
 */
@Injectable()
export class PaymentLinkApiService {
  constructor(
    @Inject(TOKEN_RESOLUTION_OBSERVABILITY_PORT) private readonly observability: TokenResolutionObservabilityPort,
  ) {}

  listAttempts(query: ResolutionQueryDto): Promise<ResolutionPage> {
    return this.observability.listAttempts({
      outcome: query.outcome,
      correlationId: query.correlationId,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit: Number.isFinite(query.limit) ? query.limit : undefined,
      cursor: query.cursor,
    });
  }

  getTrace(correlationId: string, query: ResolutionQueryDto): Promise<ResolutionPage> {
    return this.listAttempts({ ...query, correlationId });
  }

  outcomeCounts(since?: string): Promise<ResolutionOutcomeCount[]> {
    return this.observability.outcomeCounts(since ? new Date(since) : undefined);
  }
}
