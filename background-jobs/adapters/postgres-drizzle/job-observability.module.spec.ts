import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgresJobObservabilityModule } from './job-observability.module';
import { PostgresJobObservabilityService } from './job-observability.service';

const APP_DB = Symbol('APP_DB');

function appDbModule(rows: Array<Record<string, unknown>> = []) {
  const execute = vi.fn().mockResolvedValue({ rows });
  @Module({ providers: [{ provide: APP_DB, useValue: { execute } }], exports: [APP_DB] })
  class AppDbModule {}
  return { AppDbModule, execute };
}

describe('PostgresJobObservabilityModule', () => {
  it('provides a PostgresJobObservabilityService wired to the db token and application', async () => {
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

    const status = await moduleRef.get(PostgresJobObservabilityService).listJobStatus();
    expect(execute).toHaveBeenCalledTimes(1);
    // the declared-cadence job shows even with no rows
    expect(status.map((s) => s.name)).toContain('invoice-reminder');
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
