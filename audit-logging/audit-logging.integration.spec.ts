import { describe, expect, it, vi } from 'vitest';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainEventsModule, DOMAIN_EVENT_EMITTER, OnCriticalEvent } from '../domain-events';
import type { DomainEventEmitter } from '../domain-events';
import { AuditLoggingModule } from './audit-logging.module';
import { AUDIT_EVENT_REPOSITORY } from './tokens';
import { AuditEventRepository } from './audit-event-repository';
import { AuditableDomainEvent } from './auditable-domain-event.interface';
import { persistAuditRecord } from './persist-audit-record';
import { runWithCorrelationId } from './correlation-context';

/**
 * A minimal real domain event, the same shape a project's own
 * InvoiceStatusChanged would be — proves AuditableDomainEvent's extends
 * DomainEvent actually composes with a real emitted class, not just a
 * hand-built fake.
 */
class TestEntityChanged implements AuditableDomainEvent {
  constructor(
    public readonly entityId: string,
    public readonly occurredAt: Date,
  ) {}

  toAuditRecord() {
    return {
      entityType: 'test_entity',
      entityId: this.entityId,
      tenantId: 'tenant-1',
      actor: 'user-1',
      action: 'changed',
      before: { status: 'old' },
      after: { status: 'new' },
    };
  }
}

/**
 * Exactly what this pattern's README tells a consumer to write themselves —
 * @OnCriticalEvent(), not @OnEvent(), and a call to persistAuditRecord().
 * Real, not a fake, so the whole emitCritical -> OnCriticalEvent ->
 * persistAuditRecord -> repository.insert() chain is proven end to end.
 */
@Injectable()
class ConsumerAuditListener {
  constructor(@Inject(AUDIT_EVENT_REPOSITORY) private readonly auditRepo: AuditEventRepository) {}

  @OnCriticalEvent('test.entity_changed')
  async handle(event: AuditableDomainEvent) {
    await persistAuditRecord(this.auditRepo, event);
  }
}

function fakeRepo(insert: AuditEventRepository['insert']): AuditEventRepository {
  return { insert };
}

const AUDIT_REPO_IMPL = Symbol('AUDIT_REPO_IMPL');

async function buildTestModule(insert: AuditEventRepository['insert']) {
  @Module({
    providers: [{ provide: AUDIT_REPO_IMPL, useValue: fakeRepo(insert) }],
    exports: [AUDIT_REPO_IMPL],
  })
  class FakeAuditRepoModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [
      DomainEventsModule.forRoot({ application: 'test-app' }),
      AuditLoggingModule.forRoot({ auditEventRepositoryToken: AUDIT_REPO_IMPL, imports: [FakeAuditRepoModule] }),
    ],
    providers: [ConsumerAuditListener],
  }).compile();

  await moduleRef.init(); // required for EventSubscribersLoader to discover @OnCriticalEvent()-decorated providers
  return moduleRef;
}

describe('audit-logging + domain-events, real end to end', () => {
  it('emitCritical() reaches the consumer-authored listener, which persists via the real repository', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const moduleRef = await buildTestModule(insert);
    const emitter = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    const event = new TestEntityChanged('entity-1', new Date('2026-02-01T00:00:00Z'));
    await emitter.emitCritical('test.entity_changed', event);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'test_entity',
        entityId: 'entity-1',
        occurredAt: event.occurredAt, // the event's own time, not Date.now() at listener execution
        reason: null,
      }),
    );
    await moduleRef.close();
  });

  it('a failed insert propagates out of emitCritical(), proving the audit-write-must-not-be-silently-dropped guarantee is real', async () => {
    const insert = vi.fn(async () => {
      throw new Error('constraint violation');
    });
    const moduleRef = await buildTestModule(insert);
    const emitter = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    let caught: unknown;
    try {
      await emitter.emitCritical('test.entity_changed', new TestEntityChanged('entity-2', new Date()));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('constraint violation');
    await moduleRef.close();
  });

  it('the correlation id established around the emit is the one persisted', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const moduleRef = await buildTestModule(insert);
    const emitter = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    await runWithCorrelationId('trace-abc', async () => {
      await emitter.emitCritical('test.entity_changed', new TestEntityChanged('entity-3', new Date()));
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'trace-abc' }));
    await moduleRef.close();
  });
});
