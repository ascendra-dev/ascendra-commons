import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WEBHOOK_OBSERVABILITY_PORT } from '../payment-gateway-adapter.core';
import { PaymentGatewayApiModule } from './payment-gateway-api.module';
import { PaymentGatewayController } from './payment-gateway.controller';

const listEvents = vi.fn().mockResolvedValue({ events: [] });
const outcomeCounts = vi.fn().mockResolvedValue([]);

@Module({
  providers: [{ provide: WEBHOOK_OBSERVABILITY_PORT, useValue: { listEvents, outcomeCounts } }],
  exports: [WEBHOOK_OBSERVABILITY_PORT],
})
class FakePortModule {}

describe('PaymentGatewayApiModule.forRoot — real DI wiring', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [PaymentGatewayApiModule.forRoot({ imports: [FakePortModule] })],
    }).compile();
  }

  it('resolves the controller', async () => {
    const moduleRef = await build();
    expect(moduleRef.get(PaymentGatewayController)).toBeInstanceOf(PaymentGatewayController);
  });

  it('routes GET /payment-gateway/webhook-events', async () => {
    const moduleRef = await build();
    await moduleRef.get(PaymentGatewayController).events('stripe');
    expect(listEvents).toHaveBeenCalledWith(expect.objectContaining({ gateway: 'stripe' }));
  });

  it('routes GET /payment-gateway/webhook-events/trace/:correlationId', async () => {
    const moduleRef = await build();
    await moduleRef.get(PaymentGatewayController).trace('trace-9');
    expect(listEvents).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'trace-9' }));
  });

  it('routes GET /payment-gateway/webhook-events/catalog', async () => {
    const moduleRef = await build();
    await moduleRef.get(PaymentGatewayController).catalog();
    expect(outcomeCounts).toHaveBeenCalledTimes(1);
  });
});
