import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { getTableColumns, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { JobRunSummary } from '../../background-jobs.core';
import { jobRunTable } from './job-run.schema';
import { PostgresJobRunRecorder } from './postgres-job-run-recorder';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function rendered(db: ReturnType<typeof fakeDb>) {
  return dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
}

function summary(overrides: Partial<JobRunSummary> = {}): JobRunSummary {
  return {
    jobName: 'invoice-reminder',
    trigger: 'scheduled',
    startedAt: new Date('2026-01-03T08:00:00Z'),
    finishedAt: new Date('2026-01-03T08:00:04Z'),
    outcome: 'completed',
    itemsDue: 3,
    itemsProcessed: 2,
    itemsFailed: 1,
    failedItemRefs: ['invoice a1'],
    error: undefined,
    ...overrides,
  };
}

describe('PostgresJobRunRecorder', () => {
  it('issues exactly one insert into commons_jobs_job_run', async () => {
    const db = fakeDb();
    await new PostgresJobRunRecorder(db, 'ascendra-pay').recordRun(summary());

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(rendered(db).sql).toMatch(/insert into commons_jobs_job_run/i);
  });

  it('stamps the injected application, not anything off the summary', async () => {
    const db = fakeDb();
    await new PostgresJobRunRecorder(db, 'ascendra-erp').recordRun(summary());

    expect(rendered(db).params).toContain('ascendra-erp');
  });

  it('binds summary fields as parameters — nothing string-interpolated', async () => {
    const db = fakeDb();
    const nasty = "'); drop table commons_jobs_job_run;--";
    await new PostgresJobRunRecorder(db, 'ascendra-pay').recordRun(summary({ failedItemRefs: [nasty] }));

    const { sql: text, params } = rendered(db);
    expect(text).not.toMatch(/drop table/i);
    expect(params).toContain(nasty);
  });

  it('writes failedItemRefs as a bound text[] and an empty list as \'{}\'::text[]', async () => {
    const withRefs = fakeDb();
    await new PostgresJobRunRecorder(withRefs, 'ascendra-pay').recordRun(summary({ failedItemRefs: ['x', 'y'] }));
    expect(rendered(withRefs).sql).toMatch(/array\[.*\]::text\[\]/is);
    expect(rendered(withRefs).params).toEqual(expect.arrayContaining(['x', 'y']));

    const empty = fakeDb();
    await new PostgresJobRunRecorder(empty, 'ascendra-pay').recordRun(summary({ failedItemRefs: [] }));
    expect(rendered(empty).sql).toMatch(/'\{\}'::text\[\]/);
  });

  it('keeps a missing error as SQL NULL, not the string "null"', async () => {
    const db = fakeDb();
    await new PostgresJobRunRecorder(db, 'ascendra-pay').recordRun(summary({ error: undefined }));
    expect(rendered(db).params).not.toContain('null');
  });

  it('writes the job-level error when outcome is job_failed', async () => {
    const db = fakeDb();
    await new PostgresJobRunRecorder(db, 'ascendra-pay').recordRun(
      summary({ outcome: 'job_failed', itemsDue: 0, itemsProcessed: 0, itemsFailed: 0, error: 'Error: query failed\n  at ...' }),
    );
    expect(rendered(db).params).toContain('Error: query failed\n  at ...');
  });

  it('writes every column the schema defines except the db-assigned id — guards against schema/INSERT drift', async () => {
    const db = fakeDb();
    await new PostgresJobRunRecorder(db, 'ascendra-pay').recordRun(summary());

    const { sql: text } = rendered(db);
    const expected = Object.values(getTableColumns(jobRunTable))
      .map((c) => (c as { name: string }).name)
      .filter((name) => name !== 'id');
    for (const column of expected) {
      expect(text).toContain(column);
    }
  });

  it('strips NUL bytes and caps each ref and the error — one odd label must not lose the run', async () => {
    const db = fakeDb();
    const refs = ['invoice\u0000a1', 'x'.repeat(2_000), ...Array.from({ length: 60 }, (_, i) => `ref ${i}`)];
    await new PostgresJobRunRecorder(db, 'ascendra-pay').recordRun(
      summary({ jobName: 'nul\u0000job', failedItemRefs: refs, error: `Error: bad\u0000\n${'at frame\n'.repeat(5_000)}` }),
    );

    const params = rendered(db).params as unknown[];
    expect(params.some((p) => typeof p === 'string' && p.includes('\u0000'))).toBe(false);
    expect(params).toContain('nuljob');
    expect(params).toContain('invoicea1');
    expect(params).not.toContain('ref 50');
    const longest = Math.max(...params.filter((p): p is string => typeof p === 'string').map((p) => p.length));
    expect(longest).toBeLessThanOrEqual(16_000 + 20);
  });

  it('falls back on an Invalid Date and a bad count instead of failing the INSERT', async () => {
    const db = fakeDb();
    await new PostgresJobRunRecorder(db, 'ascendra-pay').recordRun(
      summary({ startedAt: new Date('nope'), finishedAt: '2026-01-03T08:00:04Z' as unknown as Date, itemsDue: Number.NaN }),
    );

    const params = rendered(db).params as unknown[];
    const dates = params.filter((p): p is Date => p instanceof Date);
    expect(dates).toHaveLength(2);
    expect(dates.every((d) => !Number.isNaN(d.getTime()))).toBe(true);
    expect(params).toContain(0);
  });

  it('keeps a well-formed correlation id and drops anything else', async () => {
    const good = fakeDb();
    await new PostgresJobRunRecorder(good, 'ascendra-pay').recordRun(summary({ correlationId: 'req-8a2f:31' }));
    expect(rendered(good).params).toContain('req-8a2f:31');

    const bad = fakeDb();
    await new PostgresJobRunRecorder(bad, 'ascendra-pay').recordRun(summary({ correlationId: '<script>' }));
    expect(rendered(bad).params).not.toContain('<script>');
  });

  it('never propagates a database failure — best-effort by contract', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('constraint violation'));

    await expect(new PostgresJobRunRecorder(db, 'ascendra-pay').recordRun(summary())).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Failed to record run'), expect.any(String));
  });
});
