import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { RateLimitObservabilityPort } from '../../rate-limiting.core';
import { RATE_LIMIT_OBSERVABILITY_PORT } from '../../rate-limiting.core';
import { PostgresRateLimitObservabilityModule } from './postgres-rate-limit-observability.module';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresRateLimitObservabilityModule', () => {
  it('resolves RATE_LIMIT_OBSERVABILITY_PORT wired to the db token and application', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresRateLimitObservabilityModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] }),
      ],
    }).compile();

    const port = moduleRef.get<RateLimitObservabilityPort>(RATE_LIMIT_OBSERVABILITY_PORT);
    await port.listRejections({ route: '/pay/:token' });

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/from commons_rate_limit_rejection/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-erp', '/pay/:token']));
  });
});
