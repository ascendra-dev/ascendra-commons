import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { InvalidJobRunCursorError } from '../../background-jobs.core';
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

  it('returns a nextCursor at microsecond precision when more rows exist, and the next page keys off it', async () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      row({ id: String(100 + i), started_at_key: '2026-06-01T08:00:00.123456Z' }),
    );
    const db = fakeDb(many);
    const page = await svc(db).getRunHistory({ limit: 50 });

    expect(page.runs).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();
    expect(page.runs[0]).not.toHaveProperty('started_at_key');

    const db2 = fakeDb([]);
    await svc(db2).getRunHistory({ cursor: page.nextCursor, limit: 50 });
    const { sql: text, params } = dialect.sqlToQuery(db2.execute.mock.calls[0][0] as SQL);
    expect(params).toEqual(expect.arrayContaining(['149', '2026-06-01T08:00:00.123456Z'])); // the 50th row — keyset boundary
    // Led by the indexed column, so the boundary is an Index Cond, not a Filter.
    expect(text).toMatch(/started_at <= .*::timestamptz and \(started_at < .* or id < .*::bigint\)/is);
    expect(text).toMatch(/order by started_at desc, id desc/i);
  });

  it('reads oldest first for order asc, with the cursor bound flipped', async () => {
    const db = fakeDb([]);
    const cursor = Buffer.from(JSON.stringify(['2026-06-01T08:00:00.000000Z', '7'])).toString('base64url');
    await svc(db).getRunHistory({ order: 'asc', cursor });
    const { sql: text } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/started_at >= .* and \(started_at > .* or id > .*\)/is);
    expect(text).toMatch(/order by started_at asc, id asc/i);
  });

  it('applies jobName / outcome / trigger / correlation / since / until filters as bound params', async () => {
    const db = fakeDb([]);
    await svc(db).getRunHistory({
      jobName: 'cleanup',
      outcome: 'job_failed',
      trigger: 'manual',
      correlationId: 'req-1',
      since: new Date('2026-05-01T00:00:00Z'),
      until: new Date('2026-05-02T00:00:00Z'),
    });

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/job_name =/i);
    expect(text).toMatch(/outcome =/i);
    expect(text).toMatch(/trigger =/i);
    expect(text).toMatch(/correlation_id =/i);
    expect(text).toMatch(/started_at >=/i);
    expect(text).toMatch(/started_at </i);
    expect(params).toEqual(expect.arrayContaining(['cleanup', 'job_failed', 'manual', 'req-1']));
  });

  it('hasFailedItems filters on items_failed both ways', async () => {
    const yes = fakeDb([]);
    await svc(yes).getRunHistory({ hasFailedItems: true });
    expect(dialect.sqlToQuery(yes.execute.mock.calls[0][0] as SQL).sql).toMatch(/items_failed > 0/i);

    const no = fakeDb([]);
    await svc(no).getRunHistory({ hasFailedItems: false });
    expect(dialect.sqlToQuery(no.execute.mock.calls[0][0] as SQL).sql).toMatch(/items_failed = 0/i);
  });

  it('caps limit at 200', async () => {
    const db = fakeDb([]);
    await svc(db).getRunHistory({ limit: 10_000 });
    expect(renderedParams(db)).toContain(201); // limit + 1
  });

  it('rejects a cursor it never issued — restarting at page one would repeat it', async () => {
    const db = fakeDb([]);
    await expect(svc(db).getRunHistory({ cursor: 'not-a-real-cursor' })).rejects.toBeInstanceOf(InvalidJobRunCursorError);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('truncates a long error to keep the full stack off list rows', async () => {
    const longStack = 'boom\n'.repeat(200); // well over 500 chars
    const db = fakeDb([row({ error: longStack })]);
    const page = await svc(db).getRunHistory();

    expect(page.runs[0].error!.length).toBeLessThan(longStack.length);
    expect(page.runs[0].error).toContain('truncated');
    expect(page.runs[0].error).toContain('GET /jobs/runs/:id');
  });

  it('leaves a short error untouched', async () => {
    const db = fakeDb([row({ error: 'short boom' })]);
    const page = await svc(db).getRunHistory();
    expect(page.runs[0].error).toBe('short boom');
  });
});

describe('PostgresJobObservabilityService.getRun', () => {
  it('scopes to application and casts id to bigint', async () => {
    const db = fakeDb([row({ id: '42' })]);
    const run = await svc(db).getRun('42');

    expect(run).toMatchObject({ id: '42' });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/id = .*::bigint/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-pay', '42']));
  });

  it('returns null when no row matches', async () => {
    const db = fakeDb([]);
    await expect(svc(db).getRun('999')).resolves.toBeNull();
  });

  it('returns null without a query for an id that is not a bigint — never a failed cast', async () => {
    const db = fakeDb([]);
    await expect(svc(db).getRun('abc')).resolves.toBeNull();
    await expect(svc(db).getRun('99999999999999999999')).resolves.toBeNull();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('returns the full, untruncated error stack — unlike list rows', async () => {
    const longStack = 'boom\n'.repeat(200);
    const db = fakeDb([row({ error: longStack })]);
    const run = await svc(db).getRun('1');

    expect(run!.error).toBe(longStack);
  });
});

describe('PostgresJobObservabilityService.getFailedItems', () => {
  it('scopes the recent-runs window to application + job, and applies the minRuns threshold as a HAVING bound', async () => {
    const db = fakeDb([]);
    await svc(db).getFailedItems('payout-sweep', 3);

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/unnest\(failed_item_refs\)/i);
    expect(text).toMatch(/having count\(\*\) >=/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-pay', 'payout-sweep', 3]));
  });

  it('maps failure_count / last_failed_at rows', async () => {
    const db = fakeDb([
      { item_ref: 'payout p_9c04', failure_count: 6, last_failed_at: new Date('2026-06-09T00:00:00Z') },
    ]);
    const items = await svc(db).getFailedItems('payout-sweep');

    expect(items).toEqual([
      { itemRef: 'payout p_9c04', failureCount: 6, lastFailedAt: new Date('2026-06-09T00:00:00Z') },
    ]);
  });

  it('defaults minRuns when omitted', async () => {
    const db = fakeDb([]);
    await svc(db).getFailedItems('payout-sweep');
    const { params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(params).toContain(2); // DEFAULT_MIN_FAILED_RUNS
  });
});

describe('PostgresJobObservabilityService.runSummary', () => {
  it('counts each kind of run over the period, scoped to the application', async () => {
    const db = fakeDb([
      { runs: '10', clean: '6', with_failed_items: '3', job_failed: '1', manual: '2', items_processed: '120', items_failed: '7', jobs: '4' },
    ]);
    const since = new Date('2026-06-01T00:00:00Z');
    await expect(svc(db).runSummary({ since })).resolves.toEqual({
      runs: 10,
      clean: 6,
      withFailedItems: 3,
      jobFailed: 1,
      manual: 2,
      itemsProcessed: 120,
      itemsFailed: 7,
      jobs: 4,
    });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/started_at >=/i);
    expect(params).toEqual(['ascendra-pay', since]);
  });

  it('reads zeros from an empty table', async () => {
    await expect(svc(fakeDb([{}])).runSummary()).resolves.toMatchObject({ runs: 0, jobs: 0 });
  });
});

describe('PostgresJobObservabilityService.volume', () => {
  it('fills 30 calendar days in the zone, with the table extent', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [{ day: '2026-06-09', runs: '5', with_failed_items: '1', job_failed: '1' }] })
      .mockResolvedValueOnce({ rows: [{ oldest: new Date('2026-03-12T00:00:00Z'), total: '812' }] })
      .mockResolvedValueOnce({ rows: [{ bytes: '81920' }] });

    const volume = await svc(db).volume('Asia/Dubai', new Date('2026-06-09T12:00:00Z'));
    expect(volume.perDay).toHaveLength(30);
    expect(volume.perDay[29]).toEqual({ day: '2026-06-09', runs: 5, withFailedItems: 1, jobFailed: 1 });
    expect(volume.perDay[0]).toMatchObject({ runs: 0 });
    expect(volume).toMatchObject({ rowCount: 812, tableSizeBytes: 81920, oldestStartedAt: new Date('2026-03-12T00:00:00Z') });
    expect(renderedParams(db)).toContain('Asia/Dubai');
  });
});

describe('PostgresJobObservabilityService.listJobStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks job names by a skip scan and reads each job\'s latest runs — no window over the whole history', async () => {
    const db = fakeDb([]);
    await svc(db).listJobStatus();
    const { sql: text } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/with recursive names/i);
    expect(text).toMatch(/cross join lateral/i);
    expect(text).not.toMatch(/row_number/i);
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

  it('infers no cadence from runs that started together — a 0s cadence would be overdue forever', async () => {
    const at = new Date(NOW - 3600_000);
    const db = fakeDb([1, 2, 3, 4].map(() => row({ job_name: 'burst', trigger: 'scheduled', started_at: at })));
    const [status] = await svc(db).listJobStatus();
    expect(status).toMatchObject({ cadence: null, overdue: false });
  });

  it('leaves cadence null (and overdue false) when nothing is declared and too few runs to infer', async () => {
    const db = fakeDb([row({ job_name: 'invoice-reminder', started_at: new Date(NOW - 30 * 86400_000) })]);
    const [status] = await svc(db).listJobStatus();

    expect(status.cadence).toBeNull();
    expect(status.overdue).toBe(false);
  });
});
