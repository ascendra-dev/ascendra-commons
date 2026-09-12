import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { RequiresAction } from '../../authorization/authorization.core';
import { PAYMENT_LINK_ACTIONS } from './payment-link-api.options';
import { PaymentLinkApiService } from './payment-link-api.service';

/**
 * Read endpoints for a payment-link security/ops screen: the resolution log,
 * a correlation trace, and outcome counts. All gated on `payment-link.view`.
 * No tenant scoping. Requires `AuthorizationGuard` wired globally as
 * `APP_GUARD` (see `authorization.core`'s README).
 */
@Controller('payment-links')
export class PaymentLinkController {
  constructor(@Inject(PaymentLinkApiService) private readonly service: PaymentLinkApiService) {}

  @Get('resolutions')
  @RequiresAction(PAYMENT_LINK_ACTIONS.VIEW)
  resolutions(
    @Query('outcome') outcome?: 'resolved' | 'not_found' | 'revoked',
    @Query('correlationId') correlationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listAttempts({
      outcome,
      correlationId,
      since,
      until,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('resolutions/trace/:correlationId')
  @RequiresAction(PAYMENT_LINK_ACTIONS.VIEW)
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

  @Get('resolutions/catalog')
  @RequiresAction(PAYMENT_LINK_ACTIONS.VIEW)
  catalog(@Query('since') since?: string) {
    return this.service.outcomeCounts(since);
  }
}
