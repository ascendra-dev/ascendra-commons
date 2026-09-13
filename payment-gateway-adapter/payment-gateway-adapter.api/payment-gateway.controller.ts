import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { RequiresAction } from '../../authorization/authorization.core';
import { WEBHOOK_ACTIONS } from './payment-gateway-api.options';
import { PaymentGatewayApiService } from './payment-gateway-api.service';

/**
 * Parses the `limit` query param, rejecting anything that isn't a finite
 * number (e.g. `?limit=abc`) instead of letting it become `NaN` and flow
 * unguarded into `Math.min`/`Math.max` and a raw SQL `limit` clause.
 */
function parseLimit(limit: string | undefined): number | undefined {
  if (limit === undefined) return undefined;
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException('limit must be a finite number');
  }
  return parsed;
}

/**
 * Read endpoints for a webhook security/ops screen: the event log, a
 * correlation trace, and outcome counts. All gated on `payment-gateway.view`.
 * No tenant scoping. Requires `AuthorizationGuard` wired globally as
 * `APP_GUARD` (see `authorization.core`'s README).
 */
@Controller('payment-gateway')
export class PaymentGatewayController {
  constructor(@Inject(PaymentGatewayApiService) private readonly service: PaymentGatewayApiService) {}

  @Get('webhook-events')
  @RequiresAction(WEBHOOK_ACTIONS.VIEW)
  events(
    @Query('gateway') gateway?: string,
    @Query('outcome') outcome?: 'applied' | 'duplicate' | 'ignored_backwards' | 'signature_invalid',
    @Query('correlationId') correlationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listEvents({
      gateway,
      outcome,
      correlationId,
      since,
      until,
      limit: parseLimit(limit),
      cursor,
    });
  }

  @Get('webhook-events/trace/:correlationId')
  @RequiresAction(WEBHOOK_ACTIONS.VIEW)
  trace(
    @Param('correlationId') correlationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.getTrace(correlationId, {
      limit: parseLimit(limit),
      cursor,
    });
  }

  @Get('webhook-events/catalog')
  @RequiresAction(WEBHOOK_ACTIONS.VIEW)
  catalog(@Query('since') since?: string) {
    return this.service.outcomeCounts(since);
  }
}
