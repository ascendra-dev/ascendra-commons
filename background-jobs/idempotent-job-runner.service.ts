import { Inject, Injectable, Logger } from '@nestjs/common';
import { AdvisoryLock } from './advisory-lock';
import { ScheduledJob } from './scheduled-job.interface';
import { ADVISORY_LOCK } from './tokens';

/**
 * The safety mechanism, implemented once for every scheduled job in the
 * application. Has no opinion on what a job's items are, what "due" means,
 * or when it should run (see the module README for scheduling composition) —
 * only on running it safely: no duplicate concurrent execution, no single
 * item's failure blocking the rest of a batch or a future run.
 */
@Injectable()
export class IdempotentJobRunner {
  private readonly logger = new Logger(IdempotentJobRunner.name);

  constructor(@Inject(ADVISORY_LOCK) private readonly lock: AdvisoryLock) {}

  async run(job: ScheduledJob<unknown>): Promise<void> {
    const lockKey = `scheduler:${job.name}`;
    const acquired = await this.lock.tryAcquire(lockKey);
    if (!acquired) return; // another instance already owns this job — including a rolling deploy's overlap window

    try {
      const due = await job.findDueItems();
      for (const item of due) {
        try {
          await job.processItem(item);
        } catch (err) {
          // One item's failure never blocks the rest of the batch — it simply stays "due"
          // (processItem never got to mark it) and is picked up again on the very next run.
          this.logger.error(`Scheduled job "${job.name}" failed on one item`, err as Error);
        }
      }
    } finally {
      // Always released, even if findDueItems() itself threw — a job-level failure (as
      // opposed to a single item's failure, caught above) still propagates out of run(),
      // but never leaves the lock held until the next scheduled fire.
      await this.lock.release(lockKey);
    }
  }
}
