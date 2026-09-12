import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUDIT_EVENT_READER } from '../audit-logging.core';
import { AuditApiModule } from './audit-api.module';
import { AuditEventsController } from './audit-events.controller';
import type { Actor } from '../../authorization/authorization.core';

const find = vi.fn().mockResolvedValue({ records: [] });

@Module({
  providers: [{ provide: AUDIT_EVENT_READER, useValue: { find } }],
  exports: [AUDIT_EVENT_READER],
})
class FakeReaderModule {}

describe('AuditApiModule.forRoot — real DI wiring', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [AuditApiModule.forRoot({ imports: [FakeReaderModule] })],
    }).compile();
  }

  it('resolves the controller', async () => {
    const moduleRef = await build();
    expect(moduleRef.get(AuditEventsController)).toBeInstanceOf(AuditEventsController);
  });

  it('routes GET /audit/events through to the reader, tenant-scoped for a non-platform actor', async () => {
    const moduleRef = await build();
    const tenantActor: Actor = { id: 'a1', persona: 'compliance', tenantId: 't1' };
    await moduleRef.get(AuditEventsController).events(tenantActor, 'invoice');
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'invoice', tenantId: 't1' }));
  });

  it('routes GET /audit/trace/:correlationId', async () => {
    const moduleRef = await build();
    const platformActor: Actor = { id: 'p1', persona: 'platform', tenantId: null };
    await moduleRef.get(AuditEventsController).trace(platformActor, 'trace-9');
    expect(find).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'trace-9' }));
  });
});
