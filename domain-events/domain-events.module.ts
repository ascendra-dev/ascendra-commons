import { DynamicModule, Module, Provider } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InProcessDomainEventEmitter } from './in-process-domain-event-emitter.service';
import { BrokerDomainEventEmitter } from './broker-domain-event-emitter.service';
import { DOMAIN_EVENTS_APPLICATION_ID, DOMAIN_EVENT_EMITTER } from './tokens';

/** Which transport backs DomainEventEmitter. Defaults to 'in-process' (Model 1). */
export type DomainEventsTransport = 'in-process' | 'broker';

export interface DomainEventsModuleConfig {
  /**
   * Which Ascendra application this process is (e.g. 'ascendra-pay',
   * 'ascendra-school-erp'). Required under `transport: 'broker'` —
   * BrokerDomainEventEmitter's stub already uses it (see its own file, and
   * this module's README, "Application identity"), and a real broker
   * transport will need it for topic naming. Optional under 'in-process':
   * nothing in this module reads it there — a single process has nothing to
   * disambiguate from. Supply it anyway only if some other provider you're
   * adding (e.g. a cross-product audit tag) wants to `@Inject(DOMAIN_EVENTS_APPLICATION_ID)`
   * — if you do, it's bound and exported the same as under 'broker'; if you
   * don't, the token simply isn't provided (injecting it fails loudly rather
   * than resolving to `undefined`).
   */
  application?: string;
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
 * A dynamic module. `transport` defaults to 'in-process', and `application`
 * is only required by the transport that actually consumes it (`'broker'`) —
 * so `DomainEventsModule.forRoot()` with no argument at all remains the normal
 * call for the common case, the same promise this module made before
 * `application` existed. `application`'s cost is paid only by the path that
 * has a use for it.
 *
 * Why forRoot() at all rather than a bare @Module: DomainEventEmitter is an
 * interface chosen at import time, and forRoot({ transport }) is where that
 * choice is made. Call sites inject the DOMAIN_EVENT_EMITTER token and are
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
  static forRoot(config: DomainEventsModuleConfig = {}): DynamicModule {
    const transport = config.transport ?? 'in-process';

    if (transport === 'broker') {
      if (!config.application) {
        throw new Error(
          "DomainEventsModule.forRoot({ transport: 'broker' }) requires application — " +
            'which Ascendra application this process is. BrokerDomainEventEmitter names it ' +
            'in every error it throws, and a real transport will need it for topic naming.',
        );
      }
      return {
        module: DomainEventsModule,
        providers: [
          { provide: DOMAIN_EVENTS_APPLICATION_ID, useValue: config.application },
          BrokerDomainEventEmitter,
          { provide: DOMAIN_EVENT_EMITTER, useExisting: BrokerDomainEventEmitter },
        ],
        exports: [DOMAIN_EVENT_EMITTER, DOMAIN_EVENTS_APPLICATION_ID],
      };
    }

    // 'in-process': application is optional — bind DOMAIN_EVENTS_APPLICATION_ID only if supplied,
    // so an omitted value fails loudly if something ever tries to inject it, rather
    // than silently resolving to undefined.
    const applicationIdProviders: Provider[] = config.application
      ? [{ provide: DOMAIN_EVENTS_APPLICATION_ID, useValue: config.application }]
      : [];

    return {
      module: DomainEventsModule,
      imports: [EventEmitterModule.forRoot({ global: false })],
      providers: [
        ...applicationIdProviders,
        InProcessDomainEventEmitter,
        { provide: DOMAIN_EVENT_EMITTER, useExisting: InProcessDomainEventEmitter },
      ],
      exports: config.application ? [DOMAIN_EVENT_EMITTER, DOMAIN_EVENTS_APPLICATION_ID] : [DOMAIN_EVENT_EMITTER],
    };
  }
}
