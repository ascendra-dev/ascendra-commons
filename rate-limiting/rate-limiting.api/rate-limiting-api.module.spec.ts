import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthorizationEnforcedGuard } from '../../authorization/authorization.core';
import { RATE_LIMIT_OBSERVABILITY_PORT } from '../rate-limiting.core';
import { RateLimitingApiModule } from './rate-limiting-api.module';
import { RateLimitingController } from './rate-limiting.controller';

const listRejections = vi.fn().mockResolvedValue({ rejections: [] });
const rejectionCatalog = vi.fn().mockResolvedValue([]);
const topIdentifiers = vi.fn().mockResolvedValue([]);

@Module({
  providers: [{ provide: RATE_LIMIT_OBSERVABILITY_PORT, useValue: { listRejections, rejectionCatalog, topIdentifiers } }],
  exports: [RATE_LIMIT_OBSERVABILITY_PORT],
})
class FakePortModule {}

describe('RateLimitingApiModule.forRoot — real DI wiring', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [RateLimitingApiModule.forRoot({ imports: [FakePortModule] })],
    }).compile();
  }

  it('resolves the controller', async () => {
    const moduleRef = await build();
    expect(moduleRef.get(RateLimitingController)).toBeInstanceOf(RateLimitingController);
  });

  it('routes GET /rate-limits/rejections', async () => {
    const moduleRef = await build();
    await moduleRef.get(RateLimitingController).rejections('/pay/:token');
    expect(listRejections).toHaveBeenCalledWith(expect.objectContaining({ route: '/pay/:token' }));
  });

  it('routes GET /rate-limits/rejections/trace/:correlationId', async () => {
    const moduleRef = await build();
    await moduleRef.get(RateLimitingController).trace('trace-9');
    expect(listRejections).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'trace-9' }));
  });

  it('routes GET /rate-limits/rejections/catalog', async () => {
    const moduleRef = await build();
    await moduleRef.get(RateLimitingController).catalog();
    expect(rejectionCatalog).toHaveBeenCalledTimes(1);
  });

  it('routes GET /rate-limits/rejections/top-identifiers, parsing limit', async () => {
    const moduleRef = await build();
    await moduleRef.get(RateLimitingController).topIdentifiers(undefined, '/pay/:token', '5');
    expect(topIdentifiers).toHaveBeenCalledWith({ since: undefined, route: '/pay/:token', limit: 5 });
  });
});

describe('RateLimitingController — fails closed', () => {
  it('declares AuthorizationEnforcedGuard on the whole controller', () => {
    // A missing global AuthorizationGuard must be a 500, never every signed-in user reading the rejection log.
    expect(Reflect.getMetadata(GUARDS_METADATA, RateLimitingController)).toContain(AuthorizationEnforcedGuard);
  });
});
