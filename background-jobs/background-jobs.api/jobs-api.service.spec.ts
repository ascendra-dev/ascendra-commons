import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JobsApiService } from './jobs-api.service';
import {
  InvalidJobRunCursorError,
  IdempotentJobRunner,
  JobTrigger,
  ScheduledJobRegistry,
  type AdvisoryLock,
  type JobObservabilityPort,
  type JobRunRecord,
  type JobRunRecorder,
} from '../background-jobs.core';
import type { JobAuditEmitter } from './job-audit.port';
import type { Actor } from '../../authorization/authorization.core';

function deps() {
  const observability: JobObservabilityPort = {
    listJobStatus: vi.fn().mockResolvedValue([]),
    getRunHistory: vi.fn().mockResolvedValue({ runs: [] }),
    getRun: vi.fn().mockResolvedValue(null),
    getFailedItems: vi.fn().mockResolvedValue([]),
    runSummary: vi.fn().mockResolvedValue({}),
    volume: vi.fn().mockResolvedValue({}),
  };
  const jobTrigger = {
    trigger: vi.fn().mockResolvedValue({ status: 'completed', itemsDue: 1, itemsProcessed: 1, itemsFailed: 0, failedItemRefs: [] }),
    availableJobs: vi.fn().mockReturnValue([]),
  } as unknown as JobTrigger;
  const audit: JobAuditEmitter = { record: vi.fn() };
  return { observability, jobTrigger, audit, svc: new JobsApiService(observability, jobTrigger, audit) };
}

const actor: Actor = { id: 'ops-1', persona: 'platform', tenantId: null };

describe('JobsApiService', () => {
  it('lists job status straight through', async () => {
    const { svc, observability } = deps();
    await svc.listJobStatus();
    expect(observability.listJobStatus).toHaveBeenCalled();
  });

  it('parses since/until into Dates', async () => {
    const { svc, observability } = deps();
    await svc.getRunHistory({ jobName: 'x', since: '2026-01-01T00:00:00Z' });
    expect(observability.getRunHistory).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'x', since: new Date('2026-01-01T00:00:00Z') }),
    );
  });

  it('getTrace folds correlationId into the query and reads oldest first', async () => {
    const { svc, observability } = deps();
    await svc.getTrace('trace-9', { order: 'desc' });
    expect(observability.getRunHistory).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'trace-9', order: 'asc' }));
  });

  it('parses hasFailedItems and passes the enums through', async () => {
    const { svc, observability } = deps();
    await svc.getRunHistory({ outcome: 'job_failed', trigger: 'manual', hasFailedItems: 'false', order: 'asc' });
    expect(observability.getRunHistory).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'job_failed', trigger: 'manual', hasFailedItems: false, order: 'asc' }),
    );
  });

  it.each([
    ['since', { since: 'yesterday' }],
    ['until', { until: 'nope' }],
    ['limit', { limit: Number.NaN }],
    ['limit', { limit: 0 }],
    ['outcome', { outcome: 'failed' }],
    ['trigger', { trigger: 'cron' }],
    ['order', { order: 'up' }],
    ['hasFailedItems', { hasFailedItems: 'yes' }],
    ['jobName', { jobName: 'a\u0000b' }],
    ['correlationId', { correlationId: 'a\u0000b' }],
  ])('a bad %s is a 400, before any query', async (_name, query) => {
    const { svc, observability } = deps();
    await expect(svc.getRunHistory(query)).rejects.toBeInstanceOf(BadRequestException);
    expect(observability.getRunHistory).not.toHaveBeenCalled();
  });

  it('a cursor the reader rejects is a 400', async () => {
    const { svc, observability } = deps();
    (observability.getRunHistory as ReturnType<typeof vi.fn>).mockRejectedValue(new InvalidJobRunCursorError('x'));
    await expect(svc.getRunHistory({ cursor: 'junk' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('summary parses since; volume checks the time zone', async () => {
    const { svc, observability } = deps();
    await svc.runSummary('2026-06-01T00:00:00Z');
    expect(observability.runSummary).toHaveBeenCalledWith({ since: new Date('2026-06-01T00:00:00Z') });
    await expect(() => svc.runSummary('soon')).toThrow(BadRequestException);
    await svc.volume('Asia/Dubai');
    expect(observability.volume).toHaveBeenCalledWith('Asia/Dubai');
    expect(() => svc.volume('Mars/Olympus')).toThrow(BadRequestException);
  });

  it('the dashboard adds registered jobs that never ran, and flags which can be triggered', async () => {
    const { svc, observability, jobTrigger } = deps();
    (observability.listJobStatus as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'b-ran', lastRun: {}, overdue: false, consecutiveFailures: 0 },
      { name: 'c-declared', lastRun: null, overdue: true, consecutiveFailures: 0 },
    ]);
    (jobTrigger.availableJobs as ReturnType<typeof vi.fn>).mockReturnValue(['b-ran', 'a-new']);
    const rows = await svc.listJobStatus();
    expect(rows.map((r) => [r.name, r.triggerable])).toEqual([
      ['a-new', true],
      ['b-ran', true],
      ['c-declared', false],
    ]);
    expect(rows[0]).toMatchObject({ lastRun: null, cadence: null, overdue: false });
  });

  it('trigger calls JobTrigger and emits an audit event', async () => {
    const { svc, jobTrigger, audit } = deps();
    const result = await svc.trigger(actor, 'invoice-reminder');
    expect(jobTrigger.trigger).toHaveBeenCalledWith('invoice-reminder', undefined);
    expect(result).toMatchObject({ status: 'completed' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'job.triggered', actorId: 'ops-1', jobName: 'invoice-reminder', result: 'completed' }),
    );
  });

  it('trigger forwards a supplied correlationId straight through to JobTrigger', async () => {
    const { svc, jobTrigger } = deps();
    await svc.trigger(actor, 'invoice-reminder', 'trace-abc');
    expect(jobTrigger.trigger).toHaveBeenCalledWith('invoice-reminder', 'trace-abc');
  });

  it('getRun returns the port row', async () => {
    const { svc, observability } = deps();
    const run = { id: '1', jobName: 'x' };
    (observability.getRun as ReturnType<typeof vi.fn>).mockResolvedValue(run);
    await expect(svc.getRun('1')).resolves.toBe(run);
  });

  it('getRun throws NotFoundException when the port returns null', async () => {
    const { svc } = deps();
    await expect(svc.getRun('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getRun with a NUL in the id is a 400', async () => {
    const { svc } = deps();
    await expect(svc.getRun('1\u0000')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getFailedItems passes jobName and minRuns straight through', async () => {
    const { svc, observability } = deps();
    await svc.getFailedItems('payout-sweep', 3);
    expect(observability.getFailedItems).toHaveBeenCalledWith('payout-sweep', 3);
  });

  it('getFailedItems with a bad minRuns is a 400', async () => {
    const { svc } = deps();
    expect(() => svc.getFailedItems('payout-sweep', Number.NaN)).toThrow(BadRequestException);
    expect(() => svc.getFailedItems('payout-sweep', -1)).toThrow(BadRequestException);
  });

  it('an unknown job is a 404 and a running one a 409 — both still audited', async () => {
    const { svc, jobTrigger, audit } = deps();
    (jobTrigger.trigger as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 'unknown_job' });
    await expect(svc.trigger(actor, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    (jobTrigger.trigger as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 'already_running' });
    await expect(svc.trigger(actor, 'busy')).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('a job_failed run is returned, not thrown — it ran and is in the history', async () => {
    const { svc, jobTrigger } = deps();
    (jobTrigger.trigger as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 'job_failed', error: 'boom' });
    await expect(svc.trigger(actor, 'x')).resolves.toEqual({ status: 'job_failed', error: 'boom' });
  });

  it('getAlerts filters the dashboard to overdue and/or repeatedly-failing jobs', async () => {
    const { svc, observability } = deps();
    (observability.listJobStatus as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'healthy', overdue: false, consecutiveFailures: 0 },
      { name: 'overdue-job', overdue: true, consecutiveFailures: 0 },
      { name: 'flaky-job', overdue: false, consecutiveFailures: 2 },
      { name: 'one-off-failure', overdue: false, consecutiveFailures: 1 },
    ]);

    const alerts = await svc.getAlerts();
    expect(alerts.map((a) => a.name)).toEqual(['flaky-job', 'overdue-job']); // sorted by name
  });
});

describe('JobsApiService — correlation id round-trip', () => {
  it("a manual trigger's correlation id shows up in getTrace()", async () => {
    // A small in-memory JobObservabilityPort standing in for a real stack adapter — just
    // enough to prove the id threaded through `trigger()` is what `getTrace()` finds, without
    // a real database. `JobTrigger` + `IdempotentJobRunner` + `ScheduledJobRegistry` are real.
    const recorded: JobRunRecord[] = [];
    let nextId = 1;
    const recorder: JobRunRecorder = {
      async recordRun(summary) {
        recorded.push({
          id: String(nextId++),
          jobName: summary.jobName,
          trigger: summary.trigger,
          startedAt: summary.startedAt,
          finishedAt: summary.finishedAt,
          outcome: summary.outcome,
          itemsDue: summary.itemsDue,
          itemsProcessed: summary.itemsProcessed,
          itemsFailed: summary.itemsFailed,
          failedItemRefs: summary.failedItemRefs,
          error: summary.error ?? null,
          correlationId: summary.correlationId ?? null,
        });
      },
    };
    const lock: AdvisoryLock = { tryAcquire: vi.fn().mockResolvedValue(true), release: vi.fn().mockResolvedValue(undefined) };
    const registry = new ScheduledJobRegistry([
      { name: 'invoice-reminder', findDueItems: vi.fn().mockResolvedValue([]), processItem: vi.fn() },
    ]);
    const jobTrigger = new JobTrigger(registry, new IdempotentJobRunner(lock, recorder));

    const observability: JobObservabilityPort = {
      listJobStatus: vi.fn(),
      getRun: vi.fn(),
      getFailedItems: vi.fn(),
      runSummary: vi.fn(),
      volume: vi.fn(),
      getRunHistory: async (query = {}) => ({
        runs: recorded.filter((r) => !query.correlationId || r.correlationId === query.correlationId),
      }),
    };
    const audit: JobAuditEmitter = { record: vi.fn() };
    const svc = new JobsApiService(observability, jobTrigger, audit);

    await svc.trigger(actor, 'invoice-reminder', 'trace-xyz-789');
    const trace = await svc.getTrace('trace-xyz-789', {});

    expect(trace.runs).toHaveLength(1);
    expect(trace.runs[0]).toMatchObject({ jobName: 'invoice-reminder', correlationId: 'trace-xyz-789' });
  });
});
