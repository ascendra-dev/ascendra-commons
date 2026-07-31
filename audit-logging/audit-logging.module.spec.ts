import { describe, expect, it, vi } from 'vitest';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditLoggingModule } from './audit-logging.module';
import { AUDIT_EVENT_REPOSITORY } from './tokens';
import { AuditEventRepository } from './audit-event-repository';

const AUDIT_REPO_IMPL = Symbol('AUDIT_REPO_IMPL');

/** Stands in for the consumer's own AuditEventRepository provider, living in its own module. */
@Module({
  providers: [{ provide: AUDIT_REPO_IMPL, useValue: { insert: vi.fn().mockResolvedValue(undefined) } }],
  exports: [AUDIT_REPO_IMPL],
})
class FakeAuditRepoModule {}

@Injectable()
class ConsumerAuditListener {
  constructor(private readonly auditRepo: AuditEventRepository) {}
  async recordSomething() {
    await this.auditRepo.insert({
      entityType: 'invoice',
      entityId: 'inv-1',
      tenantId: 't1',
      actor: 'user-1',
      action: 'status_changed',
      before: null,
      after: null,
      correlationId: 'c1',
      reason: null,
      occurredAt: new Date(),
    });
  }
}

async function buildTestModule() {
  return Test.createTestingModule({
    imports: [AuditLoggingModule.forRoot({ auditEventRepositoryToken: AUDIT_REPO_IMPL, imports: [FakeAuditRepoModule] })],
    providers: [{ provide: ConsumerAuditListener, useFactory: (repo: AuditEventRepository) => new ConsumerAuditListener(repo), inject: [AUDIT_EVENT_REPOSITORY] }],
  }).compile();
}

describe('AuditLoggingModule.forRoot — real DI wiring', () => {
  it("aliases AUDIT_EVENT_REPOSITORY to the consumer's own repository token, injectable by a consumer-authored listener", async () => {
    const moduleRef = await buildTestModule();
    const repo = moduleRef.get<AuditEventRepository>(AUDIT_EVENT_REPOSITORY);
    const listener = moduleRef.get(ConsumerAuditListener);

    await listener.recordSomething();

    // Only reachable if AUDIT_EVENT_REPOSITORY really resolved to FakeAuditRepoModule's
    // provider — a missing imports entry (the exact bug background-jobs' own DI test
    // caught) would have thrown "Nest can't resolve dependencies" at compile() instead.
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });
});
