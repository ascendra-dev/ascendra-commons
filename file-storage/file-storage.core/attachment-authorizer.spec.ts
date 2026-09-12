import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { RegistryAttachmentAuthorizer } from './attachment-authorizer';
import { Authorizer, Actor } from '../../authorization/authorization.core';
import { EntityAccessChecker } from './entity-access-checker.interface';

const actor: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };

describe('RegistryAttachmentAuthorizer', () => {
  it('assertCanAttach resolves when both the coarse permission and the entity check pass', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };
    const checkers: Record<string, EntityAccessChecker> = { invoice: { canAccess: vi.fn().mockResolvedValue(true) } };
    const auth = new RegistryAttachmentAuthorizer(authorizer, checkers);

    await expect(auth.assertCanAttach(actor, 'invoice', 'inv-1')).resolves.toBeUndefined();
    expect(authorizer.can).toHaveBeenCalledWith(actor, 'attachment.upload');
    expect(checkers.invoice.canAccess).toHaveBeenCalledWith(actor, 'inv-1');
  });

  it('assertCanView uses the view action, not the upload action', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };
    const checkers: Record<string, EntityAccessChecker> = { invoice: { canAccess: vi.fn().mockResolvedValue(true) } };
    const auth = new RegistryAttachmentAuthorizer(authorizer, checkers);

    await auth.assertCanView(actor, 'invoice', 'inv-1');

    expect(authorizer.can).toHaveBeenCalledWith(actor, 'attachment.view');
  });

  it('throws Forbidden when the coarse permission fails, without ever consulting the entity checker', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(false) };
    const checkers: Record<string, EntityAccessChecker> = { invoice: { canAccess: vi.fn() } };
    const auth = new RegistryAttachmentAuthorizer(authorizer, checkers);

    await expect(auth.assertCanAttach(actor, 'invoice', 'inv-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(checkers.invoice.canAccess).not.toHaveBeenCalled();
  });

  it('throws Forbidden when the coarse permission passes but the entity checker denies', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };
    const checkers: Record<string, EntityAccessChecker> = { invoice: { canAccess: vi.fn().mockResolvedValue(false) } };
    const auth = new RegistryAttachmentAuthorizer(authorizer, checkers);

    await expect(auth.assertCanView(actor, 'invoice', 'inv-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed for an unregistered entity type, rather than silently allowing it', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };
    const checkers: Record<string, EntityAccessChecker> = {}; // no 'invoice' registered
    const auth = new RegistryAttachmentAuthorizer(authorizer, checkers);

    await expect(auth.assertCanAttach(actor, 'invoice', 'inv-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
