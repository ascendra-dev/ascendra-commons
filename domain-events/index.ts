export { DomainEventsModule } from './domain-events.module';
export type { DomainEventsModuleConfig, DomainEventsTransport } from './domain-events.module';
export type { DomainEventEmitter } from './domain-event-emitter';
export { DOMAIN_EVENT_EMITTER, DOMAIN_EVENTS_APPLICATION_ID } from './tokens';
export { InProcessDomainEventEmitter } from './in-process-domain-event-emitter.service';
export {
  BrokerDomainEventEmitter,
  BrokerTransportNotImplementedError,
} from './broker-domain-event-emitter.service';
export type { DomainEvent } from './domain-event.interface';
export {
  assertDomainEventSerializable,
  DomainEventNotSerializableError,
} from './assert-domain-event-serializable';
export type { JsonPrimitive, JsonValue } from './assert-domain-event-serializable';
export { OnCriticalEvent } from './on-critical-event.decorator';
