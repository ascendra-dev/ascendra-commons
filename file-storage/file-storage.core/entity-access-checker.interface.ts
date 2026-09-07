import type { Actor } from '../../authorization/authorization.core';

/**
 * Answers "does this actor have a relationship to *this* entity" — one
 * implementation per entity type the consuming project actually has (e.g.
 * an InvoiceAccessChecker checking invoice ownership, an IssuerAccessChecker
 * checking issuer identity). Deliberately narrow: not "can they do X," just
 * "do they have any legitimate claim on this specific row at all." The
 * coarse "can this kind of actor ever do this" question is Authorizer's job
 * (authorization pattern), not this one — see RegistryAttachmentAuthorizer,
 * which composes both.
 *
 * This and `RegistryAttachmentAuthorizer` are tools the vertical's **own**
 * upload/view controllers use — `AttachmentService` does not call them (a
 * vertical has many entity types with their own access endpoints, so it keeps
 * full control of authorization; the service is handed an already-authorized
 * `actor`).
 */
export interface EntityAccessChecker {
  canAccess(actor: Actor, entityId: string): Promise<boolean>;
}
