import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, Module } from '@nestjs/common';
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

  it('rejects a non-numeric limit on webhook-events instead of forwarding NaN', async () => {
    const moduleRef = await build();
    const controller = moduleRef.get(PaymentGatewayController);
    listEvents.mockClear();
    expect(() => controller.events(undefined, undefined, undefined, undefined, undefined, 'not-a-number')).toThrow(
      BadRequestException,
    );
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric limit on the trace endpoint instead of forwarding NaN', async () => {
    const moduleRef = await build();
    const controller = moduleRef.get(PaymentGatewayController);
    listEvents.mockClear();
    expect(() => controller.trace('trace-9', 'not-a-number')).toThrow(BadRequestException);
    expect(listEvents).not.toHaveBeenCalled();
  });
});
