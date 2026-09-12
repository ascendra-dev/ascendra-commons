import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresJobObservabilityService } from './postgres-job-observability.service';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb(rows: Array<Record<string, unknown>> = []) {
  return { execute: vi.fn().mockResolvedValue({ rows }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function renderedParams(db: ReturnType<typeof fakeDb>, call = 0): unknown[] {
  return dialect.sqlToQuery(db.execute.mock.calls[call][0] as SQL).params;
}

let idSeq = 0;
function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  idSeq += 1;
  return {
    id: String(idSeq),
    job_name: 'invoice-reminder',
    trigger: 'scheduled',
    started_at: new Date('2026-06-01T08:00:00Z'),
    finished_at: new Date('2026-06-01T08:00:03Z'),
    outcome: 'completed',
    items_due: 3,
    items_processed: 3,
    items_failed: 0,
    failed_item_refs: [],
    error: null,
    ...over,
  };
}

const NOW = new Date('2026-06-10T00:00:00Z').getTime();
function svc(db: SqlExecutor, cadences: Record<string, string | number> = {}) {
  return new PostgresJobObservabilityService(db, 'ascendra-pay', cadences);
}

describe('PostgresJobObservabilityService.getRunHistory', () => {
  it('maps rows and scopes to the application', async () => {
    const db = fakeDb([row({ job_name: 'a' }), row({ job_name: 'b' })]);
    const page = await svc(db).getRunHistory();

    expect(page.runs).toHaveLength(2);
    expect(page.runs[0]).toMatchObject({ jobName: 'a', outcome: 'completed', itemsDue: 3, failedItemRefs: [] });
    expect(page.nextCursor).toBeUndefined();
    expect(renderedParams(db)).toContain('ascendra-pay');
  });

  it('returns a nextCursor when more rows exist, and the next page keys off it', async () => {
    const many = Array.from({ length: 51 }, (_, i) => row({ id: String(100 + i) }));
    const db = fakeDb(many);
    const page = await svc(db).getRunHistory({ limit: 50 });

    expect(page.runs).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();

    const db2 = fakeDb([]);
    await svc(db2).getRunHistory({ cursor: page.nextCursor, limit: 50 });
    const params = renderedParams(db2).map(String);
    expect(params).toContain('149'); // the 50th row's id — keyset boundary
  });

  it('applies jobName / outcome / since filters as bound params', async () => {
    const db = fakeDb([]);
    await svc(db).getRunHistory({ jobName: 'cleanup', outcome: 'job_failed', since: new Date('2026-05-01T00:00:00Z') });

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/job_name =/i);
    expect(text).toMatch(/outcome =/i);
    expect(text).toMatch(/started_at >=/i);
    expect(params).toEqual(expect.arrayContaining(['cleanup', 'job_failed']));
  });

  it('caps limit at 200', async () => {
    const db = fakeDb([]);
    await svc(db).getRunHistory({ limit: 10_000 });
    expect(renderedParams(db)).toContain(201); // limit + 1
  });

  it('ignores a malformed cursor rather than throwing', async () => {
    const db = fakeDb([]);
    await expect(svc(db).getRunHistory({ cursor: 'not-a-real-cursor' })).resolves.toEqual({ runs: [] });
  });
});

describe('PostgresJobObservabilityService.listJobStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups by job and derives last run, last success, and consecutive failures', async () => {
    const db = fakeDb([
      // invoice-reminder: newest first — fail, fail, success
      row({ job_name: 'invoice-reminder', outcome: 'job_failed', items_failed: 0, started_at: new Date('2026-06-09T08:00:00Z'), error: 'boom' }),
      row({ job_name: 'invoice-reminder', outcome: 'completed', items_failed: 2, started_at: new Date('2026-06-08T08:00:00Z') }),
      row({ job_name: 'invoice-reminder', outcome: 'completed', items_failed: 0, started_at: new Date('2026-06-07T08:00:00Z') }),
      // cleanup: one clean run
      row({ job_name: 'cleanup', outcome: 'completed', items_failed: 0, started_at: new Date('2026-06-09T23:30:00Z') }),
    ]);

    const statuses = await svc(db).listJobStatus();
    const invoice = statuses.find((s) => s.name === 'invoice-reminder')!;
    const cleanup = statuses.find((s) => s.name === 'cleanup')!;

    expect(invoice.lastRun?.outcome).toBe('job_failed');
    expect(invoice.lastSuccessAt).toEqual(new Date('2026-06-07T08:00:00Z'));
    expect(invoice.consecutiveFailures).toBe(2); // job_failed + completed-with-itemsFailed
    expect(cleanup.consecutiveFailures).toBe(0);
    expect(statuses.map((s) => s.name)).toEqual(['cleanup', 'invoice-reminder']); // sorted
  });

  it('flags overdue against a declared cadence (1.5x factor)', async () => {
    // last run 5 days ago, cadence 1 day → 5 > 1.5 → overdue
    const db = fakeDb([row({ job_name: 'invoice-reminder', started_at: new Date(NOW - 5 * 86400_000) })]);
    const [status] = await svc(db, { 'invoice-reminder': '1d' }).listJobStatus();

    expect(status.cadence).toEqual({ source: 'declared', seconds: 86400, label: '1 day' });
    expect(status.overdue).toBe(true);
    expect(status.overdueBy).toBe('4 days');
  });

  it('does not flag overdue when within cadence * 1.5', async () => {
    const db = fakeDb([row({ job_name: 'invoice-reminder', started_at: new Date(NOW - 20 * 3600_000) })]); // 20h ago
    const [status] = await svc(db, { 'invoice-reminder': '1d' }).listJobStatus();
    expect(status.overdue).toBe(false);
  });

  it('lists a declared-cadence job that has never run, as overdue', async () => {
    const db = fakeDb([]);
    const [status] = await svc(db, { 'nightly-export': '1d' }).listJobStatus();

    expect(status).toMatchObject({ name: 'nightly-export', lastRun: null, overdue: true });
  });

  it('infers a cadence from the median gap of recent scheduled runs when none is declared', async () => {
    const day = 86400_000;
    const db = fakeDb([
      row({ job_name: 'invoice-reminder', trigger: 'scheduled', started_at: new Date(NOW - 1 * day) }),
      row({ job_name: 'invoice-reminder', trigger: 'manual', started_at: new Date(NOW - 1.5 * day) }), // off-schedule, ignored
      row({ job_name: 'invoice-reminder', trigger: 'scheduled', started_at: new Date(NOW - 2 * day) }),
      row({ job_name: 'invoice-reminder', trigger: 'scheduled', started_at: new Date(NOW - 3 * day) }),
      row({ job_name: 'invoice-reminder', trigger: 'scheduled', started_at: new Date(NOW - 4 * day) }),
    ]);
    const [status] = await svc(db).listJobStatus();

    expect(status.cadence).toMatchObject({ source: 'inferred', label: '1 day' });
  });

  it('leaves cadence null (and overdue false) when nothing is declared and too few runs to infer', async () => {
    const db = fakeDb([row({ job_name: 'invoice-reminder', started_at: new Date(NOW - 30 * 86400_000) })]);
    const [status] = await svc(db).listJobStatus();

    expect(status.cadence).toBeNull();
    expect(status.overdue).toBe(false);
  });
});
