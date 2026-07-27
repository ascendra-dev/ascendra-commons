import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainEventEmitter } from './domain-event-emitter.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [DomainEventEmitter],
  exports: [DomainEventEmitter],
})
export class DomainEventsModule {}
