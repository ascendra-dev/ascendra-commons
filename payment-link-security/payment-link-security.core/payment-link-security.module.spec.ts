import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PaymentLinkSecurityModule } from './payment-link-security.module';
import type { PaymentLinkTokenService } from './payment-link-token-service.port';
import { PAYMENT_LINK_TOKEN_SERVICE } from './tokens';

const FAKE_SERVICE = Symbol('FAKE_SERVICE');
const resolve = vi.fn().mockResolvedValue({ resourceId: 'inv-1', subjectId: 'payer-1' });

@Module({
  providers: [
    {
      provide: FAKE_SERVICE,
      useValue: { generate: vi.fn(), resolve, revoke: vi.fn() } satisfies PaymentLinkTokenService,
    },
  ],
  exports: [FAKE_SERVICE],
})
class FakeInfraModule {}

describe('PaymentLinkSecurityModule.forRoot — token wiring', () => {
  it('throws without serviceToken', () => {
    // @ts-expect-error — deliberately omitting the required field
    expect(() => PaymentLinkSecurityModule.forRoot({})).toThrow(/requires serviceToken/);
  });

  it('aliases PAYMENT_LINK_TOKEN_SERVICE to serviceToken', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PaymentLinkSecurityModule.forRoot({ serviceToken: FAKE_SERVICE, imports: [FakeInfraModule] })],
    }).compile();

    const service = moduleRef.get<PaymentLinkTokenService>(PAYMENT_LINK_TOKEN_SERVICE);
    await expect(service.resolve('tok')).resolves.toEqual({ resourceId: 'inv-1', subjectId: 'payer-1' });
  });
});
