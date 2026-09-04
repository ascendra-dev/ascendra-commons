import { DynamicModule, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InProcessDomainEventEmitter } from './in-process-domain-event-emitter.service';
import { BrokerDomainEventEmitter } from './broker-domain-event-emitter.service';
import { APPLICATION_ID, DOMAIN_EVENT_EMITTER } from './tokens';

/** Which transport backs DomainEventEmitter. Defaults to 'in-process' (Model 1). */
export type DomainEventsTransport = 'in-process' | 'broker';

export interface DomainEventsModuleConfig {
  /**
   * Which Ascendra application this process is (e.g. 'ascendra-pay',
   * 'ascendra-school-erp'). Required under both transports — not because
   * 'in-process' needs it today, but because "which app is this" is a fact
   * about the process, not the transport, and the cost of declaring it now
   * (one string, one field) is far cheaper than discovering it's missing once
   * several applications share a broker cluster. See tokens.ts (APPLICATION_ID)
   * and this module's README, "Application identity".
   */
  application: string;
  /**
   * 'in-process' (default) — EventEmitter2, listeners in the same process,
   * emitCritical() runs inside the caller's transaction.
   * 'broker' — Model 2, not implemented yet: BrokerDomainEventEmitter throws on
   * every call. The option exists so the seam is real now; see
   * broker-domain-event-emitter.service.ts.
   */
  transport?: DomainEventsTransport;
}

/**
 * A dynamic module. Unlike NotificationModule/AuthorizationModule — which need
 * forRoot() because they have real business config with no sensible default —
 * this one used to need no config at all when transport defaulted to
 * 'in-process'. That's no longer true: `application` has no sensible default
 * (there is no correct guess for "which app is this"), so forRoot() now always
 * requires an argument. Everything else about the transport knob is unchanged.
 *
 * Why forRoot() at all rather than the previous bare @Module: DomainEventEmitter
 * is now an interface chosen at import time, and forRoot({ transport }) is where
 * that choice is made. Call sites inject the DOMAIN_EVENT_EMITTER token and are
 * unaffected by which transport is bound.
 *
 * Why { global: false } on the in-process path: EventEmitterModule.forRoot()
 * defaults to { global: true }, which would let any module inject the raw
 * EventEmitter2 directly and bypass emit()/emitCritical()'s reliability
 * tiering. { global: false } scopes EventEmitter2 to modules that import this
 * one. It does not affect @OnEvent()/@OnCriticalEvent() listener discovery —
 * EventSubscribersLoader scans every provider via DiscoveryService regardless.
 */
@Module({})
export class DomainEventsModule {
  static forRoot(config: DomainEventsModuleConfig): DynamicModule {
    const transport = config.transport ?? 'in-process';
    const applicationIdProvider = { provide: APPLICATION_ID, useValue: config.application };

    if (transport === 'broker') {
      return {
        module: DomainEventsModule,
        providers: [
          applicationIdProvider,
          BrokerDomainEventEmitter,
          { provide: DOMAIN_EVENT_EMITTER, useExisting: BrokerDomainEventEmitter },
        ],
        exports: [DOMAIN_EVENT_EMITTER, APPLICATION_ID],
      };
    }

    return {
      module: DomainEventsModule,
      imports: [EventEmitterModule.forRoot({ global: false })],
      providers: [
        applicationIdProvider,
        InProcessDomainEventEmitter,
        { provide: DOMAIN_EVENT_EMITTER, useExisting: InProcessDomainEventEmitter },
      ],
      exports: [DOMAIN_EVENT_EMITTER, APPLICATION_ID],
    };
  }
}
