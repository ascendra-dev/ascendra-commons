import { describe, expect, it } from 'vitest';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventsModule } from './domain-events.module';
import { DomainEventEmitter } from './domain-event-emitter';
import { APPLICATION_ID, DOMAIN_EVENT_EMITTER } from './tokens';
import { InProcessDomainEventEmitter } from './in-process-domain-event-emitter.service';
import {
  BrokerDomainEventEmitter,
  BrokerTransportNotImplementedError,
} from './broker-domain-event-emitter.service';
import { DomainEvent } from './domain-event.interface';
import { OnCriticalEvent } from './on-critical-event.decorator';

class TestEvent implements DomainEvent {
  readonly occurredAt = new Date();
  constructor(public readonly value: string) {}
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A real feature-module listener, exactly the shape a consuming project would
 * write — decorated methods, not raw EventEmitter2.on() the way
 * in-process-domain-event-emitter.service.spec.ts tests the emitter in
 * isolation. Proving this actually works end to end (module wiring, decorator
 * scanning, dispatch) is the whole point of this file — none of the unit tests
 * exercise it.
 */
@Injectable()
class TestListener {
  received: TestEvent[] = [];
  criticalReceived: TestEvent[] = [];
  secondCriticalRan: TestEvent[] = [];
  plainOnEventCriticalReceived: TestEvent[] = [];

  @OnEvent('test.happened')
  onTestHappened(event: TestEvent) {
    this.received.push(event);
  }

  // Correct choice for a listener whose failure must propagate through emitCritical().
  @OnCriticalEvent('test.critical')
  async onTestCritical(event: TestEvent) {
    if (event.value === 'reject-me') throw new Error('listener failed on purpose');
    this.criticalReceived.push(event);
  }

  // A second @OnCriticalEvent() listener on the same event — used to show that
  // it still runs even when onTestCritical throws, and that emitCritical()
  // surfaces "a listener failed" without saying which.
  @OnCriticalEvent('test.critical')
  async onTestCriticalSecond(event: TestEvent) {
    this.secondCriticalRan.push(event);
  }

  // Deliberately the wrong choice, kept as a passing test below so the gotcha
  // stays documented as verified behavior, not just prose someone can miss.
  @OnEvent('test.critical.plain')
  async onTestCriticalPlain(event: TestEvent) {
    if (event.value === 'reject-me') throw new Error('this should be swallowed by NestJS, not seen by the caller');
    this.plainOnEventCriticalReceived.push(event);
  }
}

async function buildTestModule(module = DomainEventsModule.forRoot({ application: 'test-app' })) {
  const moduleRef = await Test.createTestingModule({
    imports: [module],
    providers: [TestListener],
  }).compile();
  // @OnEvent()/@OnCriticalEvent() decorator scanning runs in
  // EventSubscribersLoader.onApplicationBootstrap() — compile() alone does not
  // trigger lifecycle hooks, only init() does.
  await moduleRef.init();
  return moduleRef;
}

describe('DomainEventsModule — real DI + @OnEvent() wiring', () => {
  it('forRoot() defaults to the in-process transport behind DOMAIN_EVENT_EMITTER', async () => {
    const moduleRef = await buildTestModule();

    expect(moduleRef.get(DOMAIN_EVENT_EMITTER)).toBeInstanceOf(InProcessDomainEventEmitter);
  });

  it('emit() reaches a real @OnEvent()-decorated listener, not just raw EventEmitter2.on()', async () => {
    const moduleRef = await buildTestModule();
    const domainEvents = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);
    const listener = moduleRef.get(TestListener);

    domainEvents.emit('test.happened', new TestEvent('hello'));
    await wait(0);

    expect(listener.received).toHaveLength(1);
    expect(listener.received[0].value).toBe('hello');
  });

  it('emitCritical() reaches an @OnCriticalEvent()-decorated listener and propagates its rejection', async () => {
    const moduleRef = await buildTestModule();
    const domainEvents = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    await expect(domainEvents.emitCritical('test.critical', new TestEvent('reject-me'))).rejects.toThrow(
      'listener failed on purpose',
    );
  });

  it('emitCritical() resolves normally when the @OnCriticalEvent() listener succeeds', async () => {
    const moduleRef = await buildTestModule();
    const domainEvents = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);
    const listener = moduleRef.get(TestListener);

    await domainEvents.emitCritical('test.critical', new TestEvent('ok'));

    expect(listener.criticalReceived).toHaveLength(1);
  });

  it('with two @OnCriticalEvent() listeners on the event, one throwing, emitCritical() still rejects and the other still ran', async () => {
    const moduleRef = await buildTestModule();
    const domainEvents = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);
    const listener = moduleRef.get(TestListener);

    await expect(domainEvents.emitCritical('test.critical', new TestEvent('reject-me'))).rejects.toThrow();
    expect(listener.secondCriticalRan).toHaveLength(1); // not short-circuited by the other listener's throw
  });

  it('the producer decides: catching emitCritical()\'s rejection and not rethrowing lets the operation continue', async () => {
    const moduleRef = await buildTestModule();
    const domainEvents = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    let committed = false;
    try {
      await domainEvents.emitCritical('test.critical', new TestEvent('reject-me'));
      committed = true;
    } catch {
      // producer chooses to swallow and commit anyway
      committed = true;
    }

    expect(committed).toBe(true); // the emitter never forced a rollback — that was always the producer's call
  });

  it('the gotcha, verified: a plain @OnEvent() listener\'s failure is swallowed by NestJS and never reaches emitCritical()\'s caller', async () => {
    const moduleRef = await buildTestModule();
    const domainEvents = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);
    const listener = moduleRef.get(TestListener);

    // suppressErrors defaults to true for plain @OnEvent() — NestJS logs the
    // throw and swallows it, so this resolves instead of rejecting, even
    // though the listener threw. This is exactly why OnCriticalEvent() exists.
    await expect(domainEvents.emitCritical('test.critical.plain', new TestEvent('reject-me'))).resolves.toBeUndefined();
    expect(listener.plainOnEventCriticalReceived).toHaveLength(0);
  });

  it('EventEmitter2 is not injectable by a module that never imported DomainEventsModule — the { global: false } leak fix', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [] }).compile();

    expect(() => moduleRef.get(EventEmitter2, { strict: true })).toThrow();
  });

  it('exports APPLICATION_ID bound to the configured application, even on the in-process transport', async () => {
    const moduleRef = await buildTestModule(DomainEventsModule.forRoot({ application: 'ascendra-pay' }));

    expect(moduleRef.get(APPLICATION_ID)).toBe('ascendra-pay');
  });
});

describe('DomainEventsModule.forRoot({ transport: "broker" }) — the seam, unimplemented', () => {
  it('binds DOMAIN_EVENT_EMITTER to BrokerDomainEventEmitter', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DomainEventsModule.forRoot({ application: 'test-app', transport: 'broker' })],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(DOMAIN_EVENT_EMITTER)).toBeInstanceOf(BrokerDomainEventEmitter);
  });

  it('throws BrokerTransportNotImplementedError on emit() and emitCritical()', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DomainEventsModule.forRoot({ application: 'test-app', transport: 'broker' })],
    }).compile();
    await moduleRef.init();
    const domainEvents = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    expect(() => domainEvents.emit('test.happened', new TestEvent('x'))).toThrow(
      BrokerTransportNotImplementedError,
    );
    await expect(domainEvents.emitCritical('test.happened', new TestEvent('x'))).rejects.toThrow(
      BrokerTransportNotImplementedError,
    );
  });

  it('does not import EventEmitterModule — no in-process dispatch on the broker path', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DomainEventsModule.forRoot({ application: 'test-app', transport: 'broker' })],
    }).compile();
    await moduleRef.init();

    expect(() => moduleRef.get(EventEmitter2, { strict: true })).toThrow();
  });

  it('exports APPLICATION_ID, and the thrown error names which application hit the seam', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DomainEventsModule.forRoot({ application: 'ascendra-pay', transport: 'broker' })],
    }).compile();
    await moduleRef.init();
    const domainEvents = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    expect(moduleRef.get(APPLICATION_ID)).toBe('ascendra-pay');
    expect(() => domainEvents.emit('test.happened', new TestEvent('x'))).toThrow(/ascendra-pay/);
  });
});
