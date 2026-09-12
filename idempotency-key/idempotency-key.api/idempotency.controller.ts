import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { RequiresAction } from '../../authorization/authorization.core';
import { IDEMPOTENCY_ACTIONS } from './idempotency-api.options';
import { IdempotencyApiService } from './idempotency-api.service';

/**
 * Read endpoints for an idempotency support/ops screen: claim lookup (by
 * `key`+`scope`), a filtered list, a cross-module correlation trace, and a
 * health summary. All gated on `idempotency.view`. No tenant scoping — see
 * `IdempotencyApiService`'s doc comment for why. Requires `AuthorizationGuard`
 * wired globally as `APP_GUARD` (see `authorization.core`'s README).
 */
@Controller('idempotency-keys')
export class IdempotencyController {
  constructor(@Inject(IdempotencyApiService) private readonly service: IdempotencyApiService) {}

  @Get()
  @RequiresAction(IDEMPOTENCY_ACTIONS.VIEW)
  claims(
    @Query('status') status?: 'pending' | 'completed',
    @Query('scope') scope?: string,
    @Query('correlationId') correlationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listClaims({
      status,
      scope,
      correlationId,
      since,
      until,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('trace/:correlationId')
  @RequiresAction(IDEMPOTENCY_ACTIONS.VIEW)
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

  @Get('health')
  @RequiresAction(IDEMPOTENCY_ACTIONS.VIEW)
  health() {
    return this.service.claimHealthSummary();
  }

  @Get(':scope/:key')
  @RequiresAction(IDEMPOTENCY_ACTIONS.VIEW)
  claim(@Param('scope') scope: string, @Param('key') key: string) {
    return this.service.getClaim(key, scope);
  }
}
