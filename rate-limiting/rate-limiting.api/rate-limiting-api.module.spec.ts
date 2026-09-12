import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RATE_LIMIT_OBSERVABILITY_PORT } from '../rate-limiting.core';
import { RateLimitingApiModule } from './rate-limiting-api.module';
import { RateLimitingController } from './rate-limiting.controller';

const listRejections = vi.fn().mockResolvedValue({ rejections: [] });
const rejectionCatalog = vi.fn().mockResolvedValue([]);

@Module({
  providers: [{ provide: RATE_LIMIT_OBSERVABILITY_PORT, useValue: { listRejections, rejectionCatalog } }],
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
});
