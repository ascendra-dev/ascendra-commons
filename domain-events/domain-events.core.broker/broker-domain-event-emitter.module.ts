import { DynamicModule, Module } from '@nestjs/common';
import { BrokerDomainEventEmitter } from './broker-domain-event-emitter.service';
import { BROKER_DOMAIN_EVENT_EMITTER, DOMAIN_EVENTS_APPLICATION_ID } from './tokens';

export interface BrokerDomainEventEmitterModuleConfig {
  /**
   * Which Ascendra application this process is (e.g. `'ascendra-pay'`).
   * Required — `BrokerDomainEventEmitter` names it in every error it throws,
   * and a real transport needs it for topic naming across applications.
   */
  application: string;
}

/**
 * Model 2 wiring — a deliberate placeholder. Provides `BrokerDomainEventEmitter`
 * (which throws `BrokerTransportNotImplementedError` on every call) under
 * `BROKER_DOMAIN_EVENT_EMITTER`, and binds `DOMAIN_EVENTS_APPLICATION_ID`.
 *
 * ```typescript
 * DomainEventsModule.forRoot({
 *   emitterToken: BROKER_DOMAIN_EVENT_EMITTER,
 *   imports: [BrokerDomainEventEmitterModule.forRoot({ application: 'ascendra-pay' })],
 * })
 * ```
 *
 * The seam (this module, the `DomainEventEmitter` interface, the token) is real
 * so adopting a broker later is a wiring change — but the transport itself is
 * genuinely not built. See `broker-domain-event-emitter.service.ts` for the
 * design work a real implementation has to resolve first.
 */
@Module({})
export class BrokerDomainEventEmitterModule {
  static forRoot(config: BrokerDomainEventEmitterModuleConfig): DynamicModule {
    if (!config?.application) {
      throw new Error(
        'BrokerDomainEventEmitterModule.forRoot() requires application — which Ascendra application ' +
          'this process is. It is named in every error the stub throws, and a real transport needs it ' +
          'for topic naming.',
      );
    }
    return {
      module: BrokerDomainEventEmitterModule,
      providers: [
        { provide: DOMAIN_EVENTS_APPLICATION_ID, useValue: config.application },
        BrokerDomainEventEmitter,
        { provide: BROKER_DOMAIN_EVENT_EMITTER, useExisting: BrokerDomainEventEmitter },
      ],
      exports: [BROKER_DOMAIN_EVENT_EMITTER, DOMAIN_EVENTS_APPLICATION_ID],
    };
  }
}
