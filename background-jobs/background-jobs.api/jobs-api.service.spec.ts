import { describe, expect, it, vi } from 'vitest';
import { JobsApiService } from './jobs-api.service';
import {
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
  };
  const jobTrigger = { trigger: vi.fn().mockResolvedValue({ status: 'completed', itemsDue: 1, itemsProcessed: 1, itemsFailed: 0, failedItemRefs: [] }) } as unknown as JobTrigger;
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

  it('getTrace folds correlationId into the query', async () => {
    const { svc, observability } = deps();
    await svc.getTrace('trace-9', {});
    expect(observability.getRunHistory).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'trace-9' }));
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
    await expect(svc.getRun('missing')).rejects.toThrow('Not Found');
  });

  it('getFailedItems passes jobName and minRuns straight through', async () => {
    const { svc, observability } = deps();
    await svc.getFailedItems('payout-sweep', 3);
    expect(observability.getFailedItems).toHaveBeenCalledWith('payout-sweep', 3);
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
    expect(alerts.map((a) => a.name)).toEqual(['overdue-job', 'flaky-job']);
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
