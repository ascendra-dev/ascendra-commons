import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { AdvisoryLock } from './advisory-lock';
import { ScheduledJob } from './scheduled-job.interface';

function fakeLock(acquired = true): AdvisoryLock {
  return {
    tryAcquire: vi.fn().mockResolvedValue(acquired),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IdempotentJobRunner', () => {
  it('does nothing if the lock is not acquired', async () => {
    const lock = fakeLock(false);
    const job: ScheduledJob<string> = {
      name: 'test-job',
      findDueItems: vi.fn(),
      processItem: vi.fn(),
    };
    const runner = new IdempotentJobRunner(lock);

    await runner.run(job);

    expect(job.findDueItems).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled(); // never acquired, nothing to release
  });

  it('processes every due item in order and releases the lock', async () => {
    const lock = fakeLock(true);
    const job: ScheduledJob<string> = {
      name: 'test-job',
      findDueItems: vi.fn().mockResolvedValue(['a', 'b', 'c']),
      processItem: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new IdempotentJobRunner(lock);

    await runner.run(job);

    expect(job.processItem).toHaveBeenCalledTimes(3);
    expect(job.processItem).toHaveBeenNthCalledWith(1, 'a');
    expect(job.processItem).toHaveBeenNthCalledWith(2, 'b');
    expect(job.processItem).toHaveBeenNthCalledWith(3, 'c');
    expect(lock.release).toHaveBeenCalledWith('scheduler:test-job');
  });

  it("isolates one item's failure — the rest of the batch still runs, and run() does not throw", async () => {
    const lock = fakeLock(true);
    const processed: string[] = [];
    const job: ScheduledJob<string> = {
      name: 'test-job',
      findDueItems: vi.fn().mockResolvedValue(['a', 'b', 'c']),
      processItem: vi.fn(async (item: string) => {
        if (item === 'b') throw new Error('boom');
        processed.push(item);
      }),
    };
    const runner = new IdempotentJobRunner(lock);

    await runner.run(job);

    expect(processed).toEqual(['a', 'c']);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('releases the lock even if findDueItems itself throws, and propagates that error', async () => {
    const lock = fakeLock(true);
    const job: ScheduledJob<string> = {
      name: 'test-job',
      findDueItems: vi.fn().mockRejectedValue(new Error('query failed')),
      processItem: vi.fn(),
    };
    const runner = new IdempotentJobRunner(lock);

    await expect(runner.run(job)).rejects.toThrow('query failed');
    expect(lock.release).toHaveBeenCalledWith('scheduler:test-job');
  });

  it('names the failing item in the per-item error log via describeItem()', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const lock = fakeLock(true);
    const job: ScheduledJob<{ id: string }> = {
      name: 'invoice-reminder',
      findDueItems: vi.fn().mockResolvedValue([{ id: 'a1' }, { id: 'b2' }]),
      processItem: vi.fn(async (item: { id: string }) => {
        if (item.id === 'b2') throw new Error('boom');
      }),
      describeItem: (item) => `invoice ${item.id}`,
    };

    await new IdempotentJobRunner(lock).run(job);

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('invoice b2'), expect.any(String));
  });

  it('falls back to batch position when describeItem() is absent or itself throws', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const lock = fakeLock(true);
    const job: ScheduledJob<string> = {
      name: 'test-job',
      findDueItems: vi.fn().mockResolvedValue(['a', 'b', 'c']),
      processItem: vi.fn(async (item: string) => {
        if (item === 'b') throw new Error('boom');
      }),
      describeItem: () => {
        throw new Error('cannot describe');
      },
    };

    await new IdempotentJobRunner(lock).run(job);

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('item 2/3'), expect.any(String));
  });

  it('does not throw, and does not mask a job-level failure, when release() itself rejects', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const lock = fakeLock(true);
    lock.release = vi.fn().mockRejectedValue(new Error('unlock failed'));

    // normal run: a rejecting release() is logged, never thrown
    const okJob: ScheduledJob<string> = {
      name: 'test-job',
      findDueItems: vi.fn().mockResolvedValue(['a']),
      processItem: vi.fn().mockResolvedValue(undefined),
    };
    await expect(new IdempotentJobRunner(lock).run(okJob)).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('failed to release'), expect.any(String));

    // job-level failure: the findDueItems error propagates, not the unlock error
    const failingJob: ScheduledJob<string> = {
      name: 'test-job',
      findDueItems: vi.fn().mockRejectedValue(new Error('query failed')),
      processItem: vi.fn(),
    };
    await expect(new IdempotentJobRunner(lock).run(failingJob)).rejects.toThrow('query failed');
  });

  it('locks and releases using the scheduler:{name} key convention', async () => {
    const lock = fakeLock(true);
    const job: ScheduledJob<string> = {
      name: 'invoice-reminder',
      findDueItems: vi.fn().mockResolvedValue([]),
      processItem: vi.fn(),
    };
    const runner = new IdempotentJobRunner(lock);

    await runner.run(job);

    expect(lock.tryAcquire).toHaveBeenCalledWith('scheduler:invoice-reminder');
    expect(lock.release).toHaveBeenCalledWith('scheduler:invoice-reminder');
  });
});
