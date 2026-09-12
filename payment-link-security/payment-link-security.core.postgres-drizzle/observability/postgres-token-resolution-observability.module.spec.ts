import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { TokenResolutionObservabilityPort } from '../../payment-link-security.core';
import { TOKEN_RESOLUTION_OBSERVABILITY_PORT } from '../../payment-link-security.core';
import { PostgresTokenResolutionObservabilityModule } from './postgres-token-resolution-observability.module';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresTokenResolutionObservabilityModule', () => {
  it('resolves TOKEN_RESOLUTION_OBSERVABILITY_PORT wired to the db token and application', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresTokenResolutionObservabilityModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] }),
      ],
    }).compile();

    const port = moduleRef.get<TokenResolutionObservabilityPort>(TOKEN_RESOLUTION_OBSERVABILITY_PORT);
    await port.listAttempts({ outcome: 'not_found' });

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/from commons_payment_link_resolution/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-erp', 'not_found']));
  });
});
