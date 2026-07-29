import { describe, expect, it } from 'vitest';
import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthorizationModule } from './authorization.module';
import { AuthorizationGuard } from './authorization.guard';
import { RequiresAction } from './requires-action.decorator';
import { Authorizer } from './authorizer';
import { AUTHORIZER } from './tokens';

/**
 * A real class with the real @RequiresAction() decorator applied — not a
 * fake metadata stub the way authorization.guard.spec.ts uses one, to prove
 * the decorator and AuthorizationGuard's Reflector.get() actually agree with
 * each other when both go through real reflect-metadata, not just that each
 * one individually behaves as expected in isolation.
 */
@Injectable()
class TestController {
  @RequiresAction('invoice.void')
  voidInvoice() {
    return 'ok';
  }

  noActionRequired() {
    return 'ok';
  }
}

function contextFor(handler: () => unknown, actor?: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => (actor ? { actor } : {}) }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

async function buildTestModule() {
  return Test.createTestingModule({
    imports: [
      AuthorizationModule.forRoot({
        personaActions: { issuer: ['invoice.void'], payer: [] },
      }),
    ],
    providers: [TestController],
  }).compile();
}

describe('AuthorizationModule.forRoot — real DI wiring', () => {
  it('resolves AUTHORIZER to a working StaticRoleMapAuthorizer', async () => {
    const moduleRef = await buildTestModule();
    const authorizer = moduleRef.get<Authorizer>(AUTHORIZER);

    await expect(authorizer.can({ id: 'u1', persona: 'issuer', tenantId: 't1' }, 'invoice.void')).resolves.toBe(true);
    await expect(authorizer.can({ id: 'u2', persona: 'payer', tenantId: null }, 'invoice.void')).resolves.toBe(false);
  });

  it('resolves AuthorizationGuard, and it correctly reads real @RequiresAction() metadata via a real Reflector', async () => {
    const moduleRef = await buildTestModule();
    const guard = moduleRef.get(AuthorizationGuard);
    const controller = moduleRef.get(TestController);

    const allowed = contextFor(controller.voidInvoice, { id: 'u1', persona: 'issuer', tenantId: 't1' });
    await expect(guard.canActivate(allowed)).resolves.toBe(true);

    const denied = contextFor(controller.voidInvoice, { id: 'u2', persona: 'payer', tenantId: null });
    await expect(guard.canActivate(denied)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes through a handler with no @RequiresAction() metadata, real reflection included', async () => {
    const moduleRef = await buildTestModule();
    const guard = moduleRef.get(AuthorizationGuard);
    const controller = moduleRef.get(TestController);

    await expect(guard.canActivate(contextFor(controller.noActionRequired))).resolves.toBe(true);
  });
});
