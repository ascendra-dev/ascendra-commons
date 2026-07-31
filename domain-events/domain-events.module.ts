import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainEventEmitter } from './domain-event-emitter.service';

/**
 * EventEmitterModule.forRoot() defaults to { global: true } — left at that
 * default, any module anywhere in the app could inject the raw EventEmitter2
 * directly (constructor(private emitter: EventEmitter2)), bypassing
 * DomainEventEmitter's emit()/emitCritical() reliability-tiering entirely,
 * with nothing to signal that the bypass happened. { global: false } here
 * closes that: EventEmitter2 (and DomainEventEmitter) are only injectable by
 * modules that actually import DomainEventsModule.
 *
 * This does not affect @OnEvent() listener discovery — @nestjs/event-emitter's
 * EventSubscribersLoader scans every provider in the app via NestJS's
 * DiscoveryService regardless of any module's global setting; only direct
 * injectability of EventEmitter2 itself is scoped by this.
 */
@Module({
  imports: [EventEmitterModule.forRoot({ global: false })],
  providers: [DomainEventEmitter],
  exports: [DomainEventEmitter],
})
export class DomainEventsModule {}
