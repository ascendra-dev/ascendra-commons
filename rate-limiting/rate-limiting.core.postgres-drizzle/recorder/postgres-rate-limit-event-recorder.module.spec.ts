import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresRateLimitEventRecorder } from './postgres-rate-limit-event-recorder';
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
  it('resolves POSTGRES_RATE_LIMIT_EVENT_RECORDER wired to the db token, application and options', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresRateLimitEventRecorderModule.forRoot({
          sqlExecutorToken: DB,
          application: 'ascendra-erp',
          maxBufferedKeys: 1,
          imports: [DbModule],
        }),
      ],
    }).compile();

    const recorder = moduleRef.get<PostgresRateLimitEventRecorder>(POSTGRES_RATE_LIMIT_EVENT_RECORDER);
    await recorder.recordRejection({ route: '/r', identifier: 'x', limit: 1, ttlMs: 1000 });
    await recorder.recordRejection({ route: '/r', identifier: 'y', limit: 1, ttlMs: 1000 });
    // Closing the module flushes the buffer.
    await moduleRef.close();

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/insert into commons_rate_limit_rejection/i);
    expect(params).toContain('ascendra-erp');
    expect(params).toContain('(overflow)'); // maxBufferedKeys reached the recorder
    expect(params).not.toContain('y');
  });
});
