import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent, DomainEventEmitter } from '../domain-events.core';

/**
 * Model 1 transport: an in-process emitter (EventEmitter2 via
 * @nestjs/event-emitter), not a message broker. Listeners run in the same
 * process — and, for emitCritical(), synchronously within the producer's own
 * call stack, so if the producer opened a transaction around the emit and
 * rethrows what emitCritical() propagates, that transaction rolls back. This
 * emitter itself never touches a transaction — the rollback decision is the
 * producer's (see domain-event-emitter.ts).
 *
 * Both methods go through emitAsync() internally so sync and async listeners
 * are handled uniformly; only whether the result is awaited/propagated differs.
 * emitCritical() rejects with whichever @OnCriticalEvent() listener fails first;
 * it does not identify or aggregate failures, and every @OnCriticalEvent()
 * listener still runs.
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
export class InProcessDomainEventEmitter implements DomainEventEmitter {
  private readonly logger = new Logger(InProcessDomainEventEmitter.name);

  // Explicit @Inject(EventEmitter2), not bare type-based constructor injection —
  // the latter depends on TypeScript's design:paramtypes reflection metadata
  // actually being emitted and read at runtime, which esbuild-based
  // transpilation (vitest, and any consumer building without tsc) does not
  // reliably support. Every other injection in this whole library already uses
  // an explicit token for this exact reason; this was the one exception.
  constructor(@Inject(EventEmitter2) private readonly emitter: EventEmitter2) {}

  emit(eventName: string, event: DomainEvent): void {
    // Not awaited by design — but still routed through emitAsync and given a
    // catch, so a listener that forgot to catch its own error becomes a
    // backstopped no-op here rather than an unhandled promise rejection. This
    // backstops listener discipline; a well-behaved listener still catches its
    // own error and records its own failure status rather than relying on
    // this catch existing. The catch still logs, though — a rejection reaching
    // here means either a listener that skipped its own try/catch (rare, since
    // NestJS's EventSubscribersLoader already logs and swallows a plain
    // @OnEvent() listener's own throw before it gets this far — see the class
    // doc comment) or, more usefully, the mismatched-pairing bug this module's
    // README warns about (emit() + @OnCriticalEvent() together: the listener's
    // own throw isn't swallowed by NestJS, so it reaches this catch instead) —
    // exactly the case that previously vanished with zero trace.
    //
    // The outer try/catch is not redundant with .catch(): a listener that throws
    // synchronously (rather than returning a rejected promise) can propagate out of
    // emitAsync() itself, before it has returned a promise for .catch() to attach to.
    try {
      void this.emitter.emitAsync(eventName, event).catch((err) => {
        this.logger.error(
          `emit('${eventName}') — a listener failed. This is swallowed by design (emit() never ` +
            `surfaces a failure to its caller), logged here only so it isn't silently invisible — ` +
            `see this module's README on the emit()+@OnCriticalEvent() mismatch. Event: ${safeStringify(event)}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    } catch (err) {
      this.logger.error(
        `emit('${eventName}') — emitAsync() itself threw synchronously, before dispatching to any ` +
          `listener. Swallowed by design, logged so it isn't silently invisible. Event: ${safeStringify(event)}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async emitCritical(eventName: string, event: DomainEvent): Promise<void> {
    // emitAsync runs every listener and Promise.all's them, so a synchronous
    // throw or an async rejection from any @OnCriticalEvent() listener surfaces
    // here. Logged before rethrowing unchanged — NestJS's own EventSubscribersLoader
    // does not log a suppressErrors: false failure itself (only the default,
    // suppressErrors: true path logs), so without this, whether the failure is
    // ever traced at all depends entirely on the producer explicitly logging
    // what it catches — and the producer swallowing without logging (a
    // legitimate, documented choice; see domain-event-emitter.ts) would
    // otherwise leave zero trace anywhere. This log does not change the
    // producer's own rollback-or-swallow decision — "a listener failed" still
    // reaches the caller exactly as before, just also written down regardless
    // of what the caller then does with it.
    try {
      await this.emitter.emitAsync(eventName, event);
    } catch (err) {
      this.logger.error(
        `emitCritical('${eventName}') — a critical listener failed. Event: ${safeStringify(event)}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }
}

/** Event payloads are already required to be JSON-serializable (see DomainEvent's own doc
 * comment) — this is never expected to throw, but a logging path is the wrong place to
 * risk a second failure over a first one, so it's defensive anyway. */
function safeStringify(event: DomainEvent): string {
  try {
    return JSON.stringify(event);
  } catch {
    return '<event could not be serialized>';
  }
}
