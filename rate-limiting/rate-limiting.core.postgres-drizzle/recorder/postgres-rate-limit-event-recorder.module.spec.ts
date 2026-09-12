import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { RateLimitEventRecorder } from '../../rate-limiting.core';
import { PostgresRateLimitEventRecorderModule } from './postgres-rate-limit-event-recorder.module';
import { POSTGRES_RATE_LIMIT_EVENT_RECORDER } from '../tokens';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresRateLimitEventRecorderModule', () => {
  it('resolves POSTGRES_RATE_LIMIT_EVENT_RECORDER wired to the db token and application', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresRateLimitEventRecorderModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] }),
      ],
    }).compile();

    const recorder = moduleRef.get<RateLimitEventRecorder>(POSTGRES_RATE_LIMIT_EVENT_RECORDER);
    await recorder.recordRejection({ route: '/r', identifier: 'x', limit: 1, ttlMs: 1000 });

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/insert into commons_rate_limit_rejection/i);
    expect(params).toContain('ascendra-erp');
  });
});
