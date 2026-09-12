import { describe, expect, it, vi } from 'vitest';
import { JobsApiService } from './jobs-api.service';
import type { JobObservabilityPort, JobTrigger } from '../background-jobs.core';
import type { JobAuditEmitter } from './job-audit.port';
import type { Actor } from '../../authorization/authorization.core';

function deps() {
  const observability: JobObservabilityPort = {
    listJobStatus: vi.fn().mockResolvedValue([]),
    getRunHistory: vi.fn().mockResolvedValue({ runs: [] }),
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
    expect(jobTrigger.trigger).toHaveBeenCalledWith('invoice-reminder');
    expect(result).toMatchObject({ status: 'completed' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'job.triggered', actorId: 'ops-1', jobName: 'invoice-reminder', result: 'completed' }),
    );
  });
});
