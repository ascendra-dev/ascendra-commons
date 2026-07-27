/**
 * Marker interface for a domain event. Events are named for what already happened
 * (InvoiceSent, PaymentConfirmed), never as a command or intent, and carry the facts
 * of what changed — not just an id and not the entire serialized entity. Business
 * logic defines one plain class per fact; this interface only fixes the one field
 * every consumer (notably an audit listener's before/after record) needs uniformly.
 */
export interface DomainEvent {
  readonly occurredAt: Date;
}
