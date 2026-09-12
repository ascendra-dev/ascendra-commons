import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JOB_OBSERVABILITY_PORT, JobTrigger } from '../background-jobs.core';
import { JobsApiModule } from './jobs-api.module';
import { JobsController } from './jobs.controller';
import { JOB_AUDIT_EMITTER } from './tokens';
import type { Actor } from '../../authorization/authorization.core';

const listJobStatus = vi.fn().mockResolvedValue([]);
const getRunHistory = vi.fn().mockResolvedValue({ runs: [] });
const trigger = vi.fn().mockResolvedValue({ status: 'completed', itemsDue: 0, itemsProcessed: 0, itemsFailed: 0, failedItemRefs: [] });
const auditRecord = vi.fn();

@Module({
  providers: [
    { provide: JOB_OBSERVABILITY_PORT, useValue: { listJobStatus, getRunHistory } },
    { provide: JobTrigger, useValue: { trigger } },
    { provide: 'MY_AUDIT', useValue: { record: auditRecord } },
  ],
  exports: [JOB_OBSERVABILITY_PORT, JobTrigger, 'MY_AUDIT'],
})
class FakePortsModule {}

describe('JobsApiModule.forRoot — real DI wiring', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [JobsApiModule.forRoot({ auditEmitterToken: 'MY_AUDIT', imports: [FakePortsModule] })],
    }).compile();
  }

  const actor: Actor = { id: 'ops-1', persona: 'platform', tenantId: null };

  it('resolves the controller', async () => {
    expect((await build()).get(JobsController)).toBeInstanceOf(JobsController);
  });

  it('dashboard + runs route through to the port', async () => {
    const ref = await build();
    await ref.get(JobsController).dashboard();
    await ref.get(JobsController).runs('invoice-reminder');
    expect(listJobStatus).toHaveBeenCalled();
    expect(getRunHistory).toHaveBeenCalledWith(expect.objectContaining({ jobName: 'invoice-reminder' }));
  });

  it('the trigger routes to JobTrigger and audits via the bound emitter', async () => {
    const ref = await build();
    await ref.get(JobsController).run(actor, 'invoice-reminder');
    expect(trigger).toHaveBeenCalledWith('invoice-reminder');
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'job.triggered' }));
  });

  it('falls back to the no-op audit emitter when auditEmitterToken is omitted', async () => {
    const ref = await Test.createTestingModule({
      imports: [JobsApiModule.forRoot({ imports: [FakePortsModule] })],
    }).compile();
    expect(ref.get(JOB_AUDIT_EMITTER)).toBeDefined();
  });
});
