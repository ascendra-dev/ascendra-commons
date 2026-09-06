export { DomainEventsModule } from './domain-events.module';
export type { DomainEventsModuleConfig } from './domain-events.module';
export type { DomainEventEmitter } from './domain-event-emitter.port';
export type { DomainEvent } from './domain-event.interface';
export { OnCriticalEvent } from './on-critical-event.decorator';
export {
  assertDomainEventSerializable,
  DomainEventNotSerializableError,
} from './assert-domain-event-serializable';
export type { JsonPrimitive, JsonValue } from './assert-domain-event-serializable';
export { DOMAIN_EVENT_EMITTER } from './tokens';
