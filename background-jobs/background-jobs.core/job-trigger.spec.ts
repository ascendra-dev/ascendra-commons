import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { AdvisoryLock } from './advisory-lock.port';
import { JobTrigger } from './job-trigger';
import { ScheduledJob } from './scheduled-job.port';
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

describe('JobTrigger.start — answers once the lock is taken, not when the run ends', () => {
  it('resolves started before findDueItems resolves, and the run goes on to be recorded', async () => {
    let release!: (items: number[]) => void;
    const findDueItems = vi.fn(() => new Promise<number[]>((r) => (release = r)));
    const recordRun = vi.fn().mockResolvedValue(undefined);
    const runner = new IdempotentJobRunner(lock(true), { recordRun });
    const job: ScheduledJob<number> = { name: 'slow', findDueItems, processItem: vi.fn() };

    const result = await new JobTrigger(new ScheduledJobRegistry([job]), runner).start('slow', 'trace-1');

    expect(result).toEqual({ status: 'started' });
    expect(recordRun).not.toHaveBeenCalled(); // still running
    release([1, 2]);
    await vi.waitFor(() =>
      expect(recordRun).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: 'manual', correlationId: 'trace-1', outcome: 'completed', itemsProcessed: 2 }),
      ),
    );
  });

  it('answers unknown_job and already_running without running anything', async () => {
    const job: ScheduledJob<unknown> = { name: 'j', findDueItems: vi.fn(), processItem: vi.fn() };
    expect(await triggerWith(job).start('nope')).toEqual({ status: 'unknown_job' });
    expect(await triggerWith(job, false).start('j')).toEqual({ status: 'already_running' });
    expect(job.findDueItems).not.toHaveBeenCalled();
  });

  it('a findDueItems failure after the start is recorded as job_failed, logged, never an unhandled rejection', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const recordRun = vi.fn().mockResolvedValue(undefined);
    const runner = new IdempotentJobRunner(lock(true), { recordRun });
    const job: ScheduledJob<unknown> = { name: 'j', findDueItems: vi.fn().mockRejectedValue(new Error('pool exhausted')), processItem: vi.fn() };

    expect(await new JobTrigger(new ScheduledJobRegistry([job]), runner).start('j', 'trace-2')).toEqual({ status: 'started' });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'job_failed', correlationId: 'trace-2' }));
  });

  it('rejects when the lock itself could not be asked for', async () => {
    const broken: AdvisoryLock = { tryAcquire: vi.fn().mockRejectedValue(new Error('db down')), release: vi.fn() };
    const job: ScheduledJob<unknown> = { name: 'j', findDueItems: vi.fn(), processItem: vi.fn() };
    const t = new JobTrigger(new ScheduledJobRegistry([job]), new IdempotentJobRunner(broken));
    await expect(t.start('j')).rejects.toThrow('db down');
  });
});
