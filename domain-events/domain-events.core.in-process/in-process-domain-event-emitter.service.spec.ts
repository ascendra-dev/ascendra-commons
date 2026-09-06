import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InProcessDomainEventEmitter } from './in-process-domain-event-emitter.service';
import { DomainEvent } from '../domain-events.core';

class TestEvent implements DomainEvent {
  readonly occurredAt = new Date();
}

class TestEventWithId implements DomainEvent {
  readonly occurredAt = new Date();
  constructor(public readonly invoiceId: string) {}
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('InProcessDomainEventEmitter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('emit — best-effort', () => {
    it('delivers the event to a registered listener', async () => {
      const raw = new EventEmitter2();
      const emitter = new InProcessDomainEventEmitter(raw);
      const received: DomainEvent[] = [];
      raw.on('test.happened', (event: DomainEvent) => received.push(event));

      emitter.emit('test.happened', new TestEvent());
      await wait(0); // let the microtask queue flush — emit() is fire-and-forget internally

      expect(received).toHaveLength(1);
    });

    it('never throws, and never surfaces an unhandled rejection, when a listener rejects', async () => {
      const raw = new EventEmitter2();
      const emitter = new InProcessDomainEventEmitter(raw);
      raw.on('test.will_fail', async () => {
        throw new Error('listener forgot to catch its own error');
      });

      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);

      expect(() => emitter.emit('test.will_fail', new TestEvent())).not.toThrow();
      await wait(10); // give the rejected listener promise a chance to (not) surface

      expect(unhandled).not.toHaveBeenCalled();
      process.off('unhandledRejection', unhandled);
    });

    it('never throws when a listener throws synchronously', async () => {
      const raw = new EventEmitter2();
      const emitter = new InProcessDomainEventEmitter(raw);
      raw.on('test.sync_fail', () => {
        throw new Error('synchronous listener failure');
      });

      expect(() => emitter.emit('test.sync_fail', new TestEvent())).not.toThrow();
      await wait(0);
    });

    it('logs (but still never throws or surfaces anything to the caller) when a listener rejects — the previously silent gap', async () => {
      const raw = new EventEmitter2();
      const emitter = new InProcessDomainEventEmitter(raw);
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      raw.on('test.will_fail', async () => {
        throw new Error('listener forgot to catch its own error');
      });

      emitter.emit('test.will_fail', new TestEventWithId('inv-1'));
      await wait(10);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message] = errorSpy.mock.calls[0];
      expect(message).toContain('test.will_fail');
      expect(message).toContain('inv-1'); // the event's own field, from JSON.stringify(event) — for tracing which record failed
    });

    it('logs when emitAsync() itself throws synchronously, before returning a promise to catch', () => {
      const brokenEmitter = {
        emitAsync: () => {
          throw new Error('emitAsync blew up before returning a promise');
        },
      } as unknown as EventEmitter2;
      const emitter = new InProcessDomainEventEmitter(brokenEmitter);
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      expect(() => emitter.emit('test.sync_boom', new TestEvent())).not.toThrow();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain('test.sync_boom');
    });
  });

  describe('emitCritical — awaited, failures reach the producer', () => {
    it('resolves normally when every listener succeeds', async () => {
      const raw = new EventEmitter2();
      const emitter = new InProcessDomainEventEmitter(raw);
      raw.on('test.ok', async () => {
        /* succeeds */
      });

      await expect(emitter.emitCritical('test.ok', new TestEvent())).resolves.toBeUndefined();
    });

    it('propagates a listener rejection back to the caller', async () => {
      const raw = new EventEmitter2();
      const emitter = new InProcessDomainEventEmitter(raw);
      raw.on('test.audit_write', async () => {
        throw new Error('audit write failed');
      });

      await expect(emitter.emitCritical('test.audit_write', new TestEvent())).rejects.toThrow(
        'audit write failed',
      );
    });

    it('propagates when a listener throws synchronously', async () => {
      const raw = new EventEmitter2();
      const emitter = new InProcessDomainEventEmitter(raw);
      raw.on('test.sync_throw', () => {
        throw new Error('synchronous critical failure');
      });

      await expect(emitter.emitCritical('test.sync_throw', new TestEvent())).rejects.toThrow(
        'synchronous critical failure',
      );
    });

    it('rejects when any listener fails, and the other listeners still ran', async () => {
      const raw = new EventEmitter2();
      const emitter = new InProcessDomainEventEmitter(raw);
      const otherRan = vi.fn();
      raw.on('test.multi', async () => {
        throw new Error('one listener failed');
      });
      raw.on('test.multi', async () => {
        otherRan();
      });

      // "a listener failed" is the whole signal — no aggregation, no attribution.
      await expect(emitter.emitCritical('test.multi', new TestEvent())).rejects.toThrow();
      expect(otherRan).toHaveBeenCalledTimes(1);
    });

    it('logs the failure before rethrowing, so a producer that swallows the rejection still leaves a trace', async () => {
      const raw = new EventEmitter2();
      const emitter = new InProcessDomainEventEmitter(raw);
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      raw.on('test.audit_write', async () => {
        throw new Error('audit write failed');
      });

      await expect(
        emitter.emitCritical('test.audit_write', new TestEventWithId('inv-2')),
      ).rejects.toThrow('audit write failed');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message] = errorSpy.mock.calls[0];
      expect(message).toContain('test.audit_write');
      expect(message).toContain('inv-2');
    });
  });
});
