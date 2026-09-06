import { describe, expect, it, vi } from 'vitest';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BackgroundJobsModule } from './background-jobs.module';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { JobTrigger } from './job-trigger';
import { NoopJobRunRecorder } from './noop-job-run-recorder';
import type { AdvisoryLock } from './advisory-lock.port';
import type { JobRunRecorder } from './job-run-recorder.port';
import type { ScheduledJob } from './scheduled-job.port';
import { JOB_RUN_RECORDER } from './tokens';

const FAKE_LOCK = Symbol('FAKE_LOCK');
const FAKE_RECORDER = Symbol('FAKE_RECORDER');

const tryAcquire = vi.fn().mockResolvedValue(true);
const release = vi.fn().mockResolvedValue(undefined);
const recordRun = vi.fn().mockResolvedValue(undefined);

@Module({
  providers: [
    { provide: FAKE_LOCK, useValue: { tryAcquire, release } satisfies AdvisoryLock },
    { provide: FAKE_RECORDER, useValue: { recordRun } satisfies JobRunRecorder },
  ],
  exports: [FAKE_LOCK, FAKE_RECORDER],
})
class FakeInfraModule {}

@Injectable()
class DemoJob implements ScheduledJob<number> {
  readonly name = 'demo-job';
  async findDueItems() {
    return [1, 2];
  }
  async processItem() {}
}

@Module({ providers: [DemoJob], exports: [DemoJob] })
class DemoJobModule {}

describe('BackgroundJobsModule.forRoot — token wiring', () => {
  it('throws without advisoryLockToken', () => {
    // @ts-expect-error — deliberately omitting the required field
    expect(() => BackgroundJobsModule.forRoot({})).toThrow(/requires advisoryLockToken/);
  });

  it('binds ADVISORY_LOCK and defaults JOB_RUN_RECORDER to the no-op', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BackgroundJobsModule.forRoot({ advisoryLockToken: FAKE_LOCK, imports: [FakeInfraModule] })],
    }).compile();

    expect(moduleRef.get(JOB_RUN_RECORDER)).toBeInstanceOf(NoopJobRunRecorder);

    const runner = moduleRef.get<IdempotentJobRunner>(IdempotentJobRunner);
    await runner.run({ name: 'x', findDueItems: async () => [], processItem: async () => {} });
    expect(tryAcquire).toHaveBeenCalledWith('scheduler:x');
    expect(release).toHaveBeenCalledWith('scheduler:x');
  });

  it('wires a real JobRunRecorder via jobRunRecorderToken, and the runner writes through it', async () => {
    recordRun.mockClear();
    const moduleRef = await Test.createTestingModule({
      imports: [
        BackgroundJobsModule.forRoot({
          advisoryLockToken: FAKE_LOCK,
          jobRunRecorderToken: FAKE_RECORDER,
          imports: [FakeInfraModule],
        }),
      ],
    }).compile();

    await moduleRef.get<IdempotentJobRunner>(IdempotentJobRunner).run({
      name: 'y',
      findDueItems: async () => [1],
      processItem: async () => {},
    });
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ jobName: 'y', itemsProcessed: 1 }));
  });

  it('JobTrigger resolves a job from the jobs list and runs it', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BackgroundJobsModule.forRoot({
          advisoryLockToken: FAKE_LOCK,
          jobs: [DemoJob],
          imports: [FakeInfraModule, DemoJobModule],
        }),
      ],
    }).compile();

    const result = await moduleRef.get<JobTrigger>(JobTrigger).trigger('demo-job');
    expect(result).toMatchObject({ status: 'completed', itemsProcessed: 2 });

    const unknown = await moduleRef.get<JobTrigger>(JobTrigger).trigger('nope');
    expect(unknown).toEqual({ status: 'unknown_job' });
  });
});
