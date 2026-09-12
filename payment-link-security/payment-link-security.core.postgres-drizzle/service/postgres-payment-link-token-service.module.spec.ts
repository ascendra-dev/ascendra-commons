import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PaymentLinkTokenService, TokenResolutionAttempt, TokenResolutionRecorder } from '../../payment-link-security.core';
import { PostgresPaymentLinkTokenServiceModule } from './postgres-payment-link-token-service.module';
import { POSTGRES_PAYMENT_LINK_TOKEN_SERVICE } from '../tokens';

const DB = Symbol('DB');
const RECORDER = Symbol('RECORDER');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [{ resource_id: 'inv-1', subject_id: 'payer-1', revoked_at: null }] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresPaymentLinkTokenServiceModule', () => {
  it('resolves POSTGRES_PAYMENT_LINK_TOKEN_SERVICE wired to the db token and application, with a no-op recorder by default', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresPaymentLinkTokenServiceModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] }),
      ],
    }).compile();

    const service = moduleRef.get<PaymentLinkTokenService>(POSTGRES_PAYMENT_LINK_TOKEN_SERVICE);
    await expect(service.resolve('tok')).resolves.toEqual({ resourceId: 'inv-1', subjectId: 'payer-1' });

    const { params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(params).toContain('ascendra-erp');
  });

  it('wires a real recorder when recorderToken is supplied', async () => {
    const { DbModule } = dbModule();
    const attempts: Array<[string, TokenResolutionAttempt]> = [];
    const recorderValue: TokenResolutionRecorder = {
      recordAttempt: vi.fn(async (token, attempt) => {
        attempts.push([token, attempt]);
      }),
    };
    @Module({ providers: [{ provide: RECORDER, useValue: recorderValue }], exports: [RECORDER] })
    class RecorderModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresPaymentLinkTokenServiceModule.forRoot({
          sqlExecutorToken: DB,
          application: 'ascendra-erp',
          recorderToken: RECORDER,
          imports: [DbModule, RecorderModule],
        }),
      ],
    }).compile();

    const service = moduleRef.get<PaymentLinkTokenService>(POSTGRES_PAYMENT_LINK_TOKEN_SERVICE);
    await service.resolve('tok');

    expect(attempts).toEqual([['tok', { outcome: 'resolved', correlationId: undefined }]]);
  });
});
