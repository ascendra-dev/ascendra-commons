import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from './domain-event.interface';

/**
 * The single emission surface business logic depends on. Reliability is tiered by
 * method, not by convention a listener author has to remember:
 *
 * - emit(): best-effort. The caller never awaits it and never sees a listener's
 *   failure — for subscribers like notifications, where a dropped delivery is a
 *   minor, recoverable inconvenience, not a reason to fail the triggering operation.
 * - emitCritical(): must-not-fail. The caller awaits it, and any listener's
 *   rejection propagates back — for subscribers like audit logging, where a
 *   silently dropped record is unacceptable.
 *
 * Both go through emitAsync() internally so sync and async listeners are handled
 * uniformly; only whether the result is awaited/propagated differs.
 *
 * IMPORTANT for emitCritical(): a listener subscribed via the plain @OnEvent()
 * decorator will NOT propagate its failure here, no matter which method raised
 * the event — @OnEvent() defaults to { suppressErrors: true }, and NestJS's own
 * EventSubscribersLoader catches, logs, and swallows the throw before it ever
 * reaches this emitter. A listener that must actually fail emitCritical()'s
 * caller (an audit listener, say) needs @OnCriticalEvent() instead of @OnEvent()
 * — see on-critical-event.decorator.ts.
 */
@Injectable()
export class DomainEventEmitter {
  // Explicit @Inject(EventEmitter2), not bare type-based constructor injection —
  // the latter depends on TypeScript's design:paramtypes reflection metadata
  // actually being emitted and read at runtime, which esbuild-based
  // transpilation (vitest, and any consumer building without tsc) does not
  // reliably support. Every other injection in this whole library already uses
  // an explicit token for this exact reason; this was the one exception.
  constructor(@Inject(EventEmitter2) private readonly emitter: EventEmitter2) {}

  emit(eventName: string, event: DomainEvent): void {
    // Not awaited by design — but still routed through emitAsync and given a no-op
    // catch, so a listener that forgot to catch its own error becomes a backstopped
    // no-op here rather than an unhandled promise rejection. This backstops listener
    // discipline; a well-behaved listener still catches its own error and records
    // its own failure status rather than relying on this catch existing.
    //
    // The outer try/catch is not redundant with .catch(): a listener that throws
    // synchronously (rather than returning a rejected promise) can propagate out of
    // emitAsync() itself, before it has returned a promise for .catch() to attach to.
    try {
      void this.emitter.emitAsync(eventName, event).catch(() => undefined);
    } catch {
      // same rationale as the .catch() above — never surface to the caller
    }
  }

  async emitCritical(eventName: string, event: DomainEvent): Promise<void> {
    await this.emitter.emitAsync(eventName, event);
  }
}
