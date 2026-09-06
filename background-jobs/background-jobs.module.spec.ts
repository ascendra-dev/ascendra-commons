import { describe, expect, it, vi } from 'vitest';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BackgroundJobsModule } from './background-jobs.module';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { JobTrigger } from './job-trigger';
import { NoopJobRunRecorder } from './noop-job-run-recorder';
import { JobRunRecorder } from './job-run-recorder.interface';
import { ScheduledJob } from './scheduled-job.interface';
import { JOB_RUN_RECORDER } from './tokens';

const DB_CONNECTION = Symbol('DB_CONNECTION');
const FAKE_RECORDER = Symbol('FAKE_RECORDER');

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

  it('binds JOB_RUN_RECORDER to NoopJobRunRecorder when no jobRunRecorderToken is given', async () => {
    const moduleRef = await buildTestModule();
    expect(moduleRef.get(JOB_RUN_RECORDER)).toBeInstanceOf(NoopJobRunRecorder);
  });

  it('aliases JOB_RUN_RECORDER to the supplied token and the runner writes each run through it', async () => {
    const recordRun = vi.fn().mockResolvedValue(undefined);

    @Module({
      providers: [{ provide: FAKE_RECORDER, useValue: { recordRun } satisfies JobRunRecorder }],
      exports: [FAKE_RECORDER],
    })
    class FakeRecorderModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        BackgroundJobsModule.forRoot({
          sqlExecutorToken: DB_CONNECTION,
          imports: [FakeDatabaseModule, FakeRecorderModule],
          jobRunRecorderToken: FAKE_RECORDER,
        }),
      ],
    }).compile();

    await moduleRef.get(IdempotentJobRunner).run(
      { name: 'wiring-test-job', findDueItems: vi.fn().mockResolvedValue(['x']), processItem: vi.fn() },
      { trigger: 'manual' },
    );

    expect(recordRun).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'wiring-test-job', trigger: 'manual', outcome: 'completed', itemsDue: 1 }),
    );
  });

  it('registers `jobs` so JobTrigger can run one by name, out of schedule', async () => {
    const processItem = vi.fn().mockResolvedValue(undefined);

    @Injectable()
    class DemoJob implements ScheduledJob<string> {
      readonly name = 'demo-job';
      findDueItems = vi.fn().mockResolvedValue(['a', 'b']);
      processItem = processItem;
    }

    @Module({ providers: [DemoJob], exports: [DemoJob] })
    class DemoModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        BackgroundJobsModule.forRoot({
          sqlExecutorToken: DB_CONNECTION,
          imports: [FakeDatabaseModule, DemoModule],
          jobs: [DemoJob],
        }),
      ],
    }).compile();

    const trigger = moduleRef.get(JobTrigger);
    expect(trigger.availableJobs()).toEqual(['demo-job']);

    const result = await trigger.trigger('demo-job');
    expect(result).toEqual({
      status: 'completed',
      itemsDue: 2,
      itemsProcessed: 2,
      itemsFailed: 0,
      failedItemRefs: [],
    });
    expect(processItem).toHaveBeenCalledTimes(2);

    expect(await trigger.trigger('never-registered')).toEqual({ status: 'unknown_job' });
  });

  it('JobTrigger resolves with an empty registry when `jobs` is omitted', async () => {
    const moduleRef = await buildTestModule();
    expect(moduleRef.get(JobTrigger).availableJobs()).toEqual([]);
  });
});
