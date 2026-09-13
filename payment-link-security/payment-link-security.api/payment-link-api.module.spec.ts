import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TOKEN_RESOLUTION_OBSERVABILITY_PORT } from '../payment-link-security.core';
import { PaymentLinkApiModule } from './payment-link-api.module';
import { PaymentLinkController } from './payment-link.controller';

const listAttempts = vi.fn().mockResolvedValue({ attempts: [] });
const outcomeCounts = vi.fn().mockResolvedValue([]);

@Module({
  providers: [{ provide: TOKEN_RESOLUTION_OBSERVABILITY_PORT, useValue: { listAttempts, outcomeCounts } }],
  exports: [TOKEN_RESOLUTION_OBSERVABILITY_PORT],
})
class FakePortModule {}

describe('PaymentLinkApiModule.forRoot — real DI wiring', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [PaymentLinkApiModule.forRoot({ imports: [FakePortModule] })],
    }).compile();
  }

  it('resolves the controller', async () => {
    const moduleRef = await build();
    expect(moduleRef.get(PaymentLinkController)).toBeInstanceOf(PaymentLinkController);
  });

  it('routes GET /payment-links/resolutions', async () => {
    const moduleRef = await build();
    await moduleRef.get(PaymentLinkController).resolutions('not_found');
    expect(listAttempts).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'not_found' }));
  });

  it('routes GET /payment-links/resolutions/trace/:correlationId', async () => {
    const moduleRef = await build();
    await moduleRef.get(PaymentLinkController).trace('trace-9');
    expect(listAttempts).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'trace-9' }));
  });

  it('routes GET /payment-links/resolutions/catalog', async () => {
    const moduleRef = await build();
    await moduleRef.get(PaymentLinkController).catalog();
    expect(outcomeCounts).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-numeric limit on GET /payment-links/resolutions with a 400', async () => {
    const moduleRef = await build();
    expect(() => moduleRef.get(PaymentLinkController).resolutions(undefined, undefined, undefined, undefined, 'abc')).toThrow(
      /limit must be a finite number/,
    );
    expect(listAttempts).not.toHaveBeenCalledWith(expect.objectContaining({ limit: NaN }));
  });

  it('rejects a non-numeric limit on GET /payment-links/resolutions/trace/:correlationId with a 400', async () => {
    const moduleRef = await build();
    expect(() => moduleRef.get(PaymentLinkController).trace('trace-9', 'abc')).toThrow(/limit must be a finite number/);
  });
});
