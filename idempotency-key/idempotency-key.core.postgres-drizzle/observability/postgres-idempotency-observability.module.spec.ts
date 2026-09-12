import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { IdempotencyObservabilityPort } from '../../idempotency-key.core';
import { IDEMPOTENCY_OBSERVABILITY_PORT } from '../../idempotency-key.core';
import { PostgresIdempotencyObservabilityModule } from './postgres-idempotency-observability.module';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresIdempotencyObservabilityModule', () => {
  it('resolves IDEMPOTENCY_OBSERVABILITY_PORT wired to the db token', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [PostgresIdempotencyObservabilityModule.forRoot({ sqlExecutorToken: DB, imports: [DbModule] })],
    }).compile();

    const port = moduleRef.get<IdempotencyObservabilityPort>(IDEMPOTENCY_OBSERVABILITY_PORT);
    await port.listClaims({ scope: 'tenant-1' });

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/from commons_idempotency_key/i);
    expect(params).toContain('tenant-1');
  });
});
