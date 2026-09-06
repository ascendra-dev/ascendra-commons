import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventsModule, DOMAIN_EVENT_EMITTER } from '../domain-events.core';
import type { DomainEventEmitter } from '../domain-events.core';
import { BrokerDomainEventEmitterModule } from './broker-domain-event-emitter.module';
import { BrokerDomainEventEmitter, BrokerTransportNotImplementedError } from './broker-domain-event-emitter.service';
import { BROKER_DOMAIN_EVENT_EMITTER, DOMAIN_EVENTS_APPLICATION_ID } from './tokens';

const EVENT = { occurredAt: new Date() };

async function wire(application = 'ascendra-pay') {
  const moduleRef = await Test.createTestingModule({
    imports: [
      DomainEventsModule.forRoot({
        emitterToken: BROKER_DOMAIN_EVENT_EMITTER,
        imports: [BrokerDomainEventEmitterModule.forRoot({ application })],
      }),
    ],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

describe('BrokerDomainEventEmitterModule wired into DomainEventsModule — the seam, unimplemented', () => {
  it('forRoot throws synchronously without application', () => {
    // @ts-expect-error — deliberately omitting the required field
    expect(() => BrokerDomainEventEmitterModule.forRoot({})).toThrow(/requires application/);
  });

  it('DOMAIN_EVENT_EMITTER resolves to BrokerDomainEventEmitter', async () => {
    const moduleRef = await wire();
    expect(moduleRef.get(DOMAIN_EVENT_EMITTER)).toBeInstanceOf(BrokerDomainEventEmitter);
    await moduleRef.close();
  });

  it('emit() and emitCritical() throw BrokerTransportNotImplementedError', async () => {
    const emitter = (await wire()).get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);
    expect(() => emitter.emit('test.happened', EVENT)).toThrow(BrokerTransportNotImplementedError);
    await expect(emitter.emitCritical('test.happened', EVENT)).rejects.toThrow(BrokerTransportNotImplementedError);
  });

  it('does not import EventEmitterModule — no in-process dispatch on the broker path', async () => {
    const moduleRef = await wire();
    expect(() => moduleRef.get(EventEmitter2, { strict: true })).toThrow();
    await moduleRef.close();
  });

  it('binds DOMAIN_EVENTS_APPLICATION_ID; the thrown error names which application hit the seam', async () => {
    const moduleRef = await wire('ascendra-erp');
    expect(moduleRef.get(DOMAIN_EVENTS_APPLICATION_ID)).toBe('ascendra-erp');
    expect(() => moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER).emit('x', EVENT)).toThrow(/ascendra-erp/);
    await moduleRef.close();
  });
});
