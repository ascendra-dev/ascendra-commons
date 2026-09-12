import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { WebhookEventLog } from '../../payment-gateway-adapter.core';
import { WEBHOOK_EVENT_LOG } from '../../payment-gateway-adapter.core';
import { PostgresWebhookEventLogModule } from './postgres-webhook-event-log.module';
import { POSTGRES_WEBHOOK_EVENT_LOG } from '../tokens';

const DB = Symbol('DB');

function dbModule() {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ gateway_reference: 'ref-1' }] }) // claim
    .mockResolvedValueOnce({ rows: [] }); // event log
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresWebhookEventLogModule', () => {
  it('resolves both POSTGRES_WEBHOOK_EVENT_LOG and the core WEBHOOK_EVENT_LOG token to the same instance', async () => {
    const { DbModule } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresWebhookEventLogModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] }),
      ],
    }).compile();

    const viaCoreToken = moduleRef.get<WebhookEventLog>(WEBHOOK_EVENT_LOG);
    const viaPostgresToken = moduleRef.get<WebhookEventLog>(POSTGRES_WEBHOOK_EVENT_LOG);
    expect(viaCoreToken).toBe(viaPostgresToken);

    await expect(viaCoreToken.claim('stripe', 'ref-1', 'succeeded')).resolves.toBe('applied');
  });
});
