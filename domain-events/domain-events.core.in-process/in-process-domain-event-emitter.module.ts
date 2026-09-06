import { DynamicModule, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InProcessDomainEventEmitter } from './in-process-domain-event-emitter.service';
import { IN_PROCESS_DOMAIN_EVENT_EMITTER } from './tokens';

/**
 * Model 1 wiring. Provides `InProcessDomainEventEmitter` and exports it under
 * `IN_PROCESS_DOMAIN_EVENT_EMITTER`.
 *
 * ```typescript
 * DomainEventsModule.forRoot({
 *   emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
 *   imports: [InProcessDomainEventEmitterModule.forRoot()],
 * })
 * ```
 *
 * **`{ global: false }`:** `EventEmitterModule.forRoot()` defaults to
 * `global: true`, which would let any module inject the raw `EventEmitter2`
 * directly and bypass `emit()` / `emitCritical()`'s reliability tiering.
 * `{ global: false }` scopes `EventEmitter2` to this package's importers. It
 * does **not** affect `@OnEvent()` / `@OnCriticalEvent()` listener discovery —
 * `EventSubscribersLoader` scans every provider via `DiscoveryService`
 * regardless of any module's `global` setting.
 */
@Module({})
export class InProcessDomainEventEmitterModule {
  static forRoot(): DynamicModule {
    return {
      module: InProcessDomainEventEmitterModule,
      imports: [EventEmitterModule.forRoot({ global: false })],
      providers: [
        InProcessDomainEventEmitter,
        { provide: IN_PROCESS_DOMAIN_EVENT_EMITTER, useExisting: InProcessDomainEventEmitter },
      ],
      exports: [IN_PROCESS_DOMAIN_EVENT_EMITTER],
    };
  }
}
