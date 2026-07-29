import { describe, expect, it, vi } from 'vitest';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { AdvisoryLock } from './advisory-lock';
import { ScheduledJob } from './scheduled-job.interface';

function fakeLock(acquired = true): AdvisoryLock {
  return {
    tryAcquire: vi.fn().mockResolvedValue(acquired),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

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
