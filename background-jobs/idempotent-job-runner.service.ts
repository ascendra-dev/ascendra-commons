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
      for (let i = 0; i < due.length; i++) {
        try {
          await job.processItem(due[i]);
        } catch (err) {
          // One item's failure never blocks the rest of the batch — it simply stays "due"
          // (processItem never got to mark it) and is picked up again on the very next run.
          this.logger.error(
            `Scheduled job "${job.name}" failed on ${this.describe(job, due[i], i, due.length)} — it stays due and retries next run`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    } finally {
      // Always released, even if findDueItems() itself threw — a job-level failure (as
      // opposed to a single item's failure, caught above) still propagates out of run(),
      // but never leaves the lock held until the next scheduled fire. The release is
      // guarded so a failure to *unlock* can never replace the primary error propagating
      // out of the try block (a rejecting await in finally would otherwise mask it).
      await this.lock.release(lockKey).catch((err) =>
        this.logger.error(
          `Scheduled job "${job.name}" failed to release its advisory lock "${lockKey}"`,
          err instanceof Error ? err.stack : String(err),
        ),
      );
    }
  }

  /** Never throws — a job's describeItem() is a logging aid, not part of the batch's success path. */
  private describe(job: ScheduledJob<unknown>, item: unknown, index: number, total: number): string {
    const fallback = `item ${index + 1}/${total}`;
    if (!job.describeItem) return fallback;
    try {
      return job.describeItem(item);
    } catch {
      return fallback;
    }
  }
}
