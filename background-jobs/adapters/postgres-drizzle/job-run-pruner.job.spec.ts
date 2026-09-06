import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { JobRunPrunerJob } from './job-run-pruner.job';
import type { SqlExecutor } from './sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe('JobRunPrunerJob', () => {
  it('has the job-run-pruner name', () => {
    expect(new JobRunPrunerJob(fakeDb(), 'ascendra-pay', 90).name).toBe('job-run-pruner');
  });

  it('findDueItems returns one cutoff, retentionDays in the past', async () => {
    const before = Date.now() - 30 * 86_400_000;
    const [cutoff] = await new JobRunPrunerJob(fakeDb(), 'ascendra-pay', 30).findDueItems();
    const after = Date.now() - 30 * 86_400_000;

    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it('processItem issues an application-scoped delete older than the cutoff', async () => {
    const db = fakeDb();
    const cutoff = new Date('2026-01-01T00:00:00Z');
    await new JobRunPrunerJob(db, 'ascendra-erp', 90).processItem(cutoff);

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/delete from commons_jobs_job_run/i);
    expect(text).toMatch(/application =/i);
    expect(text).toMatch(/started_at </i);
    expect(params).toContain('ascendra-erp');
    expect(params).toContain(cutoff);
  });

  it('describeItem names the application and cutoff', () => {
    const job = new JobRunPrunerJob(fakeDb(), 'ascendra-pay', 90);
    expect(job.describeItem(new Date('2026-01-01T00:00:00Z'))).toContain('ascendra-pay');
    expect(job.describeItem(new Date('2026-01-01T00:00:00Z'))).toContain('2026-01-01');
  });
});
