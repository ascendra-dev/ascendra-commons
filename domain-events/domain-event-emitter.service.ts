import { Injectable } from '@nestjs/common';
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
 */
@Injectable()
export class DomainEventEmitter {
  constructor(private readonly emitter: EventEmitter2) {}

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
