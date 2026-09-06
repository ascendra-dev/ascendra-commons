import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JOB_OBSERVABILITY_PORT, type JobObservabilityPort } from '../../background-jobs.core';
import { PostgresJobObservabilityModule } from './postgres-job-observability.module';
import { PostgresJobObservabilityService } from './postgres-job-observability.service';

const APP_DB = Symbol('APP_DB');

function appDbModule(rows: Array<Record<string, unknown>> = []) {
  const execute = vi.fn().mockResolvedValue({ rows });
  @Module({ providers: [{ provide: APP_DB, useValue: { execute } }], exports: [APP_DB] })
  class AppDbModule {}
  return { AppDbModule, execute };
}

describe('PostgresJobObservabilityModule', () => {
  it('binds JOB_OBSERVABILITY_PORT to the Postgres service, wired to the db token + application', async () => {
    const { AppDbModule, execute } = appDbModule([]);

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresJobObservabilityModule.forRoot({
          sqlExecutorToken: APP_DB,
          application: 'ascendra-erp',
          cadences: { 'invoice-reminder': '1d' },
          imports: [AppDbModule],
        }),
      ],
    }).compile();

    const port = moduleRef.get<JobObservabilityPort>(JOB_OBSERVABILITY_PORT);
    expect(port).toBeInstanceOf(PostgresJobObservabilityService);

    const status = await port.listJobStatus();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(status.map((s) => s.name)).toContain('invoice-reminder');
    await moduleRef.close();
  });

  it('throws at startup on an unparseable cadence', async () => {
    const { AppDbModule } = appDbModule();
    await expect(
      Test.createTestingModule({
        imports: [
          PostgresJobObservabilityModule.forRoot({
            sqlExecutorToken: APP_DB,
            application: 'ascendra-pay',
            cadences: { 'bad-job': 'every night' },
            imports: [AppDbModule],
          }),
        ],
      }).compile(),
    ).rejects.toThrow(/Invalid cadence/);
  });
});
