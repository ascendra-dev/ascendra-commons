import { describe, expect, it } from 'vitest';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DomainEventsModule, OnCriticalEvent, DOMAIN_EVENT_EMITTER } from '../domain-events.core';
import type { DomainEvent, DomainEventEmitter } from '../domain-events.core';
import { InProcessDomainEventEmitterModule } from './in-process-domain-event-emitter.module';
import { InProcessDomainEventEmitter } from './in-process-domain-event-emitter.service';
import { IN_PROCESS_DOMAIN_EVENT_EMITTER } from './tokens';

class TestEvent implements DomainEvent {
  readonly occurredAt = new Date();
  constructor(public readonly value: string) {}
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
class TestListener {
  received: TestEvent[] = [];
  criticalReceived: TestEvent[] = [];
  secondCriticalRan: TestEvent[] = [];
  plainCritical: TestEvent[] = [];

  @OnEvent('test.happened')
  onTestHappened(event: TestEvent) {
    this.received.push(event);
  }

  @OnCriticalEvent('test.critical')
  async onTestCritical(event: TestEvent) {
    if (event.value === 'reject-me') throw new Error('listener failed on purpose');
    this.criticalReceived.push(event);
  }

  @OnCriticalEvent('test.critical')
  async onTestCriticalSecond(event: TestEvent) {
    this.secondCriticalRan.push(event);
  }

  @OnEvent('test.critical.plain')
  async onTestCriticalPlain(event: TestEvent) {
    if (event.value === 'reject-me') throw new Error('this should be swallowed by NestJS');
    this.plainCritical.push(event);
  }
}

async function build() {
  const moduleRef = await Test.createTestingModule({
    imports: [
      DomainEventsModule.forRoot({
        emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
        imports: [InProcessDomainEventEmitterModule.forRoot()],
      }),
    ],
    providers: [TestListener],
  }).compile();
  await moduleRef.init(); // EventSubscribersLoader.onApplicationBootstrap scans decorators
  return moduleRef;
}

describe('InProcessDomainEventEmitterModule wired into DomainEventsModule — real DI + @OnEvent wiring', () => {
  it('DOMAIN_EVENT_EMITTER resolves to the in-process emitter', async () => {
    expect((await build()).get(DOMAIN_EVENT_EMITTER)).toBeInstanceOf(InProcessDomainEventEmitter);
  });

  it('emit() reaches a real @OnEvent()-decorated listener', async () => {
    const moduleRef = await build();
    moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER).emit('test.happened', new TestEvent('hello'));
    await wait(0);
    expect(moduleRef.get(TestListener).received[0]?.value).toBe('hello');
  });

  it('emitCritical() propagates an @OnCriticalEvent() listener rejection', async () => {
    const emitter = (await build()).get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);
    await expect(emitter.emitCritical('test.critical', new TestEvent('reject-me'))).rejects.toThrow(
      'listener failed on purpose',
    );
  });

  it('emitCritical() resolves when the listener succeeds', async () => {
    const moduleRef = await build();
    await moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER).emitCritical('test.critical', new TestEvent('ok'));
    expect(moduleRef.get(TestListener).criticalReceived).toHaveLength(1);
  });

  it('with two @OnCriticalEvent() listeners, one throwing, emitCritical() still rejects and the other still ran', async () => {
    const moduleRef = await build();
    await expect(
      moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER).emitCritical('test.critical', new TestEvent('reject-me')),
    ).rejects.toThrow();
    expect(moduleRef.get(TestListener).secondCriticalRan).toHaveLength(1);
  });

  it('the gotcha, verified: a plain @OnEvent() listener\'s failure is swallowed and never reaches emitCritical()\'s caller', async () => {
    const moduleRef = await build();
    await expect(
      moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER).emitCritical('test.critical.plain', new TestEvent('reject-me')),
    ).resolves.toBeUndefined();
    expect(moduleRef.get(TestListener).plainCritical).toHaveLength(0);
  });

  it('{ global: false }: EventEmitter2 is not injectable by a module that never imported this one', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [] }).compile();
    expect(() => moduleRef.get(EventEmitter2, { strict: true })).toThrow();
  });
});
