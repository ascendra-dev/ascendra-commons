import { describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InProcessDomainEventEmitter } from './in-process-domain-event-emitter.service';
import { DomainEvent } from './domain-event.interface';

class TestEvent implements DomainEvent {
  readonly occurredAt = new Date();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('InProcessDomainEventEmitter', () => {
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
  });

  describe('emitCritical — must-not-fail', () => {
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
  });
});
