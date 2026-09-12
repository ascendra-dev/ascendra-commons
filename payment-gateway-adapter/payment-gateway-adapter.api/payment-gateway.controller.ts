import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { RequiresAction } from '../../authorization/authorization.core';
import { WEBHOOK_ACTIONS } from './payment-gateway-api.options';
import { PaymentGatewayApiService } from './payment-gateway-api.service';

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
      limit: limit !== undefined ? Number(limit) : undefined,
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
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('webhook-events/catalog')
  @RequiresAction(WEBHOOK_ACTIONS.VIEW)
  catalog(@Query('since') since?: string) {
    return this.service.outcomeCounts(since);
  }
}
