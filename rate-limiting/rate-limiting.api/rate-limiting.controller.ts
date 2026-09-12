import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { RequiresAction } from '../../authorization/authorization.core';
import { RATE_LIMIT_ACTIONS } from './rate-limiting-api.options';
import { RateLimitingApiService } from './rate-limiting-api.service';

/**
 * Read endpoints for a rate-limiting security/ops screen: the rejection log,
 * a correlation trace, and per-route counts. All gated on `rate-limit.view`.
 * No tenant scoping. Requires `AuthorizationGuard` wired globally as
 * `APP_GUARD` (see `authorization.core`'s README).
 */
@Controller('rate-limits')
export class RateLimitingController {
  constructor(@Inject(RateLimitingApiService) private readonly service: RateLimitingApiService) {}

  @Get('rejections')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
  rejections(
    @Query('route') route?: string,
    @Query('identifier') identifier?: string,
    @Query('correlationId') correlationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listRejections({
      route,
      identifier,
      correlationId,
      since,
      until,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('rejections/trace/:correlationId')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
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

  @Get('rejections/catalog')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
  catalog(@Query('since') since?: string) {
    return this.service.rejectionCatalog(since);
  }
}
