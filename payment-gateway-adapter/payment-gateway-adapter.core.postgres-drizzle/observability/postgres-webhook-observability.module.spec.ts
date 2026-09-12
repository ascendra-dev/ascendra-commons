import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { WebhookObservabilityPort } from '../../payment-gateway-adapter.core';
import { WEBHOOK_OBSERVABILITY_PORT } from '../../payment-gateway-adapter.core';
import { PostgresWebhookObservabilityModule } from './postgres-webhook-observability.module';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresWebhookObservabilityModule', () => {
  it('resolves WEBHOOK_OBSERVABILITY_PORT wired to the db token and application', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresWebhookObservabilityModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] }),
      ],
    }).compile();

    const port = moduleRef.get<WebhookObservabilityPort>(WEBHOOK_OBSERVABILITY_PORT);
    await port.listEvents({ gateway: 'stripe' });

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/from commons_payment_gateway_webhook_event/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-erp', 'stripe']));
  });
});
