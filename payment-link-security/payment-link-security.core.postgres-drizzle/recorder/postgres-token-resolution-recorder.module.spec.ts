import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { TokenResolutionRecorder } from '../../payment-link-security.core';
import { PostgresTokenResolutionRecorderModule } from './postgres-token-resolution-recorder.module';
import { POSTGRES_TOKEN_RESOLUTION_RECORDER } from '../tokens';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresTokenResolutionRecorderModule', () => {
  it('resolves POSTGRES_TOKEN_RESOLUTION_RECORDER wired to the db token and application', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresTokenResolutionRecorderModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] }),
      ],
    }).compile();

    const recorder = moduleRef.get<TokenResolutionRecorder>(POSTGRES_TOKEN_RESOLUTION_RECORDER);
    await recorder.recordAttempt('tok', { outcome: 'resolved' });

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/insert into commons_payment_link_resolution/i);
    expect(params).toContain('ascendra-erp');
  });
});
