import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BackgroundJobsModule } from './background-jobs.module';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { ScheduledJob } from './scheduled-job.interface';

const DB_CONNECTION = Symbol('DB_CONNECTION');

/**
 * Stands in for a consuming app's own Drizzle db provider. BackgroundJobsModule.forRoot()
 * never provides a database connection itself — it aliases SQL_EXECUTOR to whichever
 * token the consumer already provides their db client under.
 */
@Module({
  providers: [
    { provide: DB_CONNECTION, useValue: { execute: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) } },
  ],
  exports: [DB_CONNECTION],
})
class FakeDatabaseModule {}

async function buildTestModule() {
  return Test.createTestingModule({
    imports: [BackgroundJobsModule.forRoot({ sqlExecutorToken: DB_CONNECTION, imports: [FakeDatabaseModule] })],
  }).compile();
}

describe('BackgroundJobsModule.forRoot — real DI wiring', () => {
  it("resolves IdempotentJobRunner wired to a real PostgresAdvisoryLock aliased to the consumer's db token", async () => {
    const moduleRef = await buildTestModule();
    const runner = moduleRef.get(IdempotentJobRunner);

    const job: ScheduledJob<string> = {
      name: 'wiring-test-job',
      findDueItems: vi.fn().mockResolvedValue(['x']),
      processItem: vi.fn().mockResolvedValue(undefined),
    };

    await runner.run(job);

    // Only reachable if SQL_EXECUTOR really resolved to DB_CONNECTION's fake executor,
    // PostgresAdvisoryLock really read {acquired: true} from it, and ADVISORY_LOCK really
    // resolved to that same PostgresAdvisoryLock instance — a missing binding or a
    // useExisting mismatch anywhere in that chain would have thrown at compile() instead.
    expect(job.processItem).toHaveBeenCalledWith('x');
  });
});
