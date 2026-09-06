import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { getTableColumns, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { JobRunSummary } from '../../job-run-recorder.interface';
import { jobRunTable } from './job-run.schema';
import { PostgresJobRunRecorder } from './postgres-job-run-recorder';
import type { SqlExecutor } from './sql-executor';

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

  it('never propagates a database failure — best-effort by contract', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('constraint violation'));

    await expect(new PostgresJobRunRecorder(db, 'ascendra-pay').recordRun(summary())).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Failed to record run'), expect.any(String));
  });
});
