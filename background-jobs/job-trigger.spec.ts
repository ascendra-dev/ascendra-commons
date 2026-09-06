import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { AdvisoryLock } from './advisory-lock';
import { JobTrigger } from './job-trigger';
import { ScheduledJob } from './scheduled-job.interface';
import { ScheduledJobRegistry } from './scheduled-job-registry';

afterEach(() => {
  vi.restoreAllMocks();
});

function lock(acquired: boolean): AdvisoryLock {
  return { tryAcquire: vi.fn().mockResolvedValue(acquired), release: vi.fn().mockResolvedValue(undefined) };
}

function triggerWith(job: ScheduledJob<unknown>, acquired = true) {
  const runner = new IdempotentJobRunner(lock(acquired));
  return new JobTrigger(new ScheduledJobRegistry([job]), runner);
}

describe('JobTrigger', () => {
  it('returns unknown_job for a name that was never registered', async () => {
    const t = new JobTrigger(new ScheduledJobRegistry([]), new IdempotentJobRunner(lock(true)));
    expect(await t.trigger('nope')).toEqual({ status: 'unknown_job' });
  });

  it('runs the job with trigger "manual" and returns its completed counts', async () => {
    const processItem = vi.fn(async (n: number) => {
      if (n === 2) throw new Error('boom');
    });
    const job: ScheduledJob<number> = {
      name: 'invoice-reminder',
      findDueItems: vi.fn().mockResolvedValue([1, 2, 3]),
      processItem,
      describeItem: (n) => `invoice ${n}`,
    };
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const result = await triggerWith(job).trigger('invoice-reminder');

    expect(result).toEqual({
      status: 'completed',
      itemsDue: 3,
      itemsProcessed: 2,
      itemsFailed: 1,
      failedItemRefs: ['invoice 2'],
    });
  });

  it('returns already_running when the advisory lock is held', async () => {
    const job: ScheduledJob<unknown> = { name: 'j', findDueItems: vi.fn(), processItem: vi.fn() };
    expect(await triggerWith(job, false).trigger('j')).toEqual({ status: 'already_running' });
    expect(job.findDueItems).not.toHaveBeenCalled();
  });

  it('returns job_failed with the error when findDueItems throws', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const job: ScheduledJob<unknown> = {
      name: 'j',
      findDueItems: vi.fn().mockRejectedValue(new Error('query failed')),
      processItem: vi.fn(),
    };

    const result = await triggerWith(job).trigger('j');

    expect(result.status).toBe('job_failed');
    expect((result as { error: string }).error).toContain('query failed');
  });

  it('availableJobs() lists the registry names', () => {
    const t = new JobTrigger(
      new ScheduledJobRegistry([
        { name: 'a', findDueItems: vi.fn(), processItem: vi.fn() },
        { name: 'b', findDueItems: vi.fn(), processItem: vi.fn() },
      ]),
      new IdempotentJobRunner(lock(true)),
    );
    expect(t.availableJobs().sort()).toEqual(['a', 'b']);
  });
});

describe('JobTrigger — correlation id', () => {
  it('forwards a correlation id into the run so it lands on the recorded summary', async () => {
    const recordRun = vi.fn().mockResolvedValue(undefined);
    const runner = new IdempotentJobRunner(lock(true), { recordRun });
    const job: ScheduledJob<never> = {
      name: 'j',
      findDueItems: vi.fn().mockResolvedValue([]),
      processItem: vi.fn(),
    };

    await new JobTrigger(new ScheduledJobRegistry([job]), runner).trigger('j', 'trace-abc');

    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'manual', correlationId: 'trace-abc' }));
  });
});
