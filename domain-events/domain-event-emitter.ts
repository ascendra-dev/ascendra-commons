import { DomainEvent } from './domain-event.interface';

/**
 * The single emission surface business logic depends on — and now an interface,
 * not a class, so the transport underneath can be chosen at module-import time
 * (DomainEventsModule.forRoot({ transport })) rather than being baked in.
 *
 * Reliability is tiered by method, not by convention a listener author has to
 * remember:
 *
 * - emit(): best-effort. The caller never awaits it and never sees a listener's
 *   failure — for subscribers like notifications, where a dropped delivery is a
 *   minor, recoverable inconvenience, not a reason to fail the triggering
 *   operation.
 * - emitCritical(): must-not-fail. The caller awaits it, and any listener's
 *   rejection propagates back — for subscribers like audit logging, where a
 *   silently dropped record is unacceptable.
 *
 * Both are async-shaped from the start (emitCritical returns Promise<void>, emit
 * returns void but is understood to dispatch asynchronously), the same reasoning
 * `authorization/authorizer.ts` gives for its can() being Promise<boolean>
 * before any async implementation exists: keeping the interface async-shaped now
 * means a later transport is a true drop-in, not a breaking change to every
 * call site.
 *
 * IMPORTANT — emitCritical()'s contract is transport-dependent. The in-process
 * transport runs the listener inside the caller's own request/transaction, so a
 * listener throw genuinely rolls the triggering operation back. A broker
 * transport cannot honour that (the subscriber is in another process); see
 * broker-domain-event-emitter.service.ts for what a real Model 2 has to resolve
 * before it can claim this method's guarantee.
 *
 * Call sites inject this via the DOMAIN_EVENT_EMITTER token, never a concrete
 * class:
 *
 *   constructor(
 *     @Inject(DOMAIN_EVENT_EMITTER) private readonly domainEvents: DomainEventEmitter,
 *   ) {}
 */
export interface DomainEventEmitter {
  /** Best-effort. Never awaited, never surfaces a listener failure to the caller. */
  emit(eventName: string, event: DomainEvent): void;

  /** Must-not-fail. Awaited by the caller; a listener's rejection propagates back. */
  emitCritical(eventName: string, event: DomainEvent): Promise<void>;
}
