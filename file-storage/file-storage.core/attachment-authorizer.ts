import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AUTHORIZER, type Actor, type Authorizer } from '../../authorization/authorization.core';
import type { EntityAccessChecker } from './entity-access-checker.interface';
import { ENTITY_ACCESS_CHECKERS } from './tokens';

/**
 * assertCanAttach/assertCanView answer two different questions at once, and
 * conflating them would be wrong: "can this kind of actor ever do this" (a
 * flat, persona-level fact — Authorizer's job) and "does this actor have a
 * relationship to *this specific* entity" (an instance-level fact that
 * depends on the entity's own type — checking invoice ownership is nothing
 * like checking issuer identity). This composes both rather than
 * reimplementing either.
 *
 * A tool the **vertical's own** controllers use — not called by
 * `AttachmentService`. A vertical typically has many upload/view endpoints
 * keyed to different entity types, so it keeps full control of authorization
 * and hands `AttachmentService` an already-authorized `actor`.
 *
 * 'attachment.upload' / 'attachment.view' are fixed action names, part of
 * this library's own contract — any persona that should be able to attach or
 * view files needs these two literal strings in the consumer's own
 * persona-action map.
 */
@Injectable()
export class RegistryAttachmentAuthorizer {
  constructor(
    @Inject(AUTHORIZER) private readonly authorizer: Authorizer,
    @Inject(ENTITY_ACCESS_CHECKERS) private readonly checkers: Record<string, EntityAccessChecker>,
  ) {}

  async assertCanAttach(actor: Actor, entityType: string, entityId: string): Promise<void> {
    if (!(await this.authorizer.can(actor, 'attachment.upload'))) throw new ForbiddenException();
    await this.assertEntityAccess(actor, entityType, entityId);
  }

  async assertCanView(actor: Actor, entityType: string, entityId: string): Promise<void> {
    if (!(await this.authorizer.can(actor, 'attachment.view'))) throw new ForbiddenException();
    await this.assertEntityAccess(actor, entityType, entityId);
  }

  private async assertEntityAccess(actor: Actor, entityType: string, entityId: string): Promise<void> {
    const checker = this.checkers[entityType];
    if (!checker) throw new ForbiddenException(); // an unregistered entity type is never accessible — fails closed, not silently open
    if (!(await checker.canAccess(actor, entityId))) throw new ForbiddenException();
  }
}
