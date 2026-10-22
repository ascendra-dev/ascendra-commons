import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { JOB_OBSERVABILITY_PORT, JobTrigger } from '../background-jobs.core';
import { JobsApiModule } from './jobs-api.module';
import { JobsController } from './jobs.controller';
import { JOB_AUDIT_EMITTER } from './tokens';
import { AuthorizationEnforcedGuard, type Actor } from '../../authorization/authorization.core';

const listJobStatus = vi.fn().mockResolvedValue([]);
const getRunHistory = vi.fn().mockResolvedValue({ runs: [] });
const getRun = vi.fn().mockResolvedValue({ id: '1', jobName: 'invoice-reminder' });
const getFailedItems = vi.fn().mockResolvedValue([]);
const trigger = vi.fn().mockResolvedValue({ status: 'completed', itemsDue: 0, itemsProcessed: 0, itemsFailed: 0, failedItemRefs: [] });
const availableJobs = vi.fn().mockReturnValue([]);
const auditRecord = vi.fn();

@Module({
  providers: [
    { provide: JOB_OBSERVABILITY_PORT, useValue: { listJobStatus, getRunHistory, getRun, getFailedItems } },
    { provide: JobTrigger, useValue: { trigger, availableJobs } },
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
    await expect(ref.get(JobsController).runs('invoice-reminder')).resolves.toEqual({ data: [], meta: {} });
    expect(listJobStatus).toHaveBeenCalled();
    expect(getRunHistory).toHaveBeenCalledWith(expect.objectContaining({ jobName: 'invoice-reminder' }));
  });

  it('the trigger routes to JobTrigger (with a generated correlation id) and audits via the bound emitter', async () => {
    const ref = await build();
    await ref.get(JobsController).run(actor, 'invoice-reminder');
    expect(trigger).toHaveBeenCalledWith('invoice-reminder', expect.any(String));
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'job.triggered' }));
  });

  it('the trigger forwards an explicit correlation id straight through instead of generating one', async () => {
    const ref = await build();
    await ref.get(JobsController).run(actor, 'invoice-reminder', 'trace-from-header');
    expect(trigger).toHaveBeenCalledWith('invoice-reminder', 'trace-from-header');
  });

  it('the trigger replaces a malformed correlation header with a fresh id', async () => {
    const ref = await build();
    await ref.get(JobsController).run(actor, 'invoice-reminder', '<script>alert(1)</script>');
    const forwarded = trigger.mock.calls[trigger.mock.calls.length - 1][1] as string;
    expect(forwarded).not.toContain('<');
    expect(forwarded).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('declares AuthorizationEnforcedGuard — fails closed without the global guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, JobsController)).toContain(AuthorizationEnforcedGuard);
  });

  it('run detail routes to the port and 404s when not found', async () => {
    const ref = await build();
    await expect(ref.get(JobsController).runDetail('1')).resolves.toMatchObject({ id: '1' });
    expect(getRun).toHaveBeenCalledWith('1');

    getRun.mockResolvedValueOnce(null);
    await expect(ref.get(JobsController).runDetail('missing')).rejects.toThrow();
  });

  it('failed-items routes to the port, parsing minRuns', async () => {
    const ref = await build();
    await ref.get(JobsController).failedItems('payout-sweep', '3');
    expect(getFailedItems).toHaveBeenCalledWith('payout-sweep', 3);
  });

  it('alerts filters the dashboard through the port', async () => {
    const ref = await build();
    listJobStatus.mockResolvedValueOnce([
      { name: 'overdue-job', overdue: true, consecutiveFailures: 0 },
      { name: 'healthy', overdue: false, consecutiveFailures: 0 },
    ]);
    const alerts = await ref.get(JobsController).alerts();
    expect((alerts as Array<{ name: string }>).map((a) => a.name)).toEqual(['overdue-job']);
  });

  it('GET /jobs/locks answers supported: false when no lock inspector is bound', async () => {
    const ref = await build();
    await expect(ref.get(JobsController).locks()).resolves.toEqual({ supported: false, locks: [] });
  });

  it('falls back to the no-op audit emitter when auditEmitterToken is omitted', async () => {
    const ref = await Test.createTestingModule({
      imports: [JobsApiModule.forRoot({ imports: [FakePortsModule] })],
    }).compile();
    expect(ref.get(JOB_AUDIT_EMITTER)).toBeDefined();
  });
});
