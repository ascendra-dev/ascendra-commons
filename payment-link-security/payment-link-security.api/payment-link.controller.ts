import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { RequiresAction } from '../../authorization/authorization.core';
import { PAYMENT_LINK_ACTIONS } from './payment-link-api.options';
import { PaymentLinkApiService } from './payment-link-api.service';

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
      limit: parseLimit(limit),
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
      limit: parseLimit(limit),
      cursor,
    });
  }

  @Get('resolutions/catalog')
  @RequiresAction(PAYMENT_LINK_ACTIONS.VIEW)
  catalog(@Query('since') since?: string) {
    return this.service.outcomeCounts(since);
  }
}
