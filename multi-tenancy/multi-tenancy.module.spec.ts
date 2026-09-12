import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContextIdFactory } from '@nestjs/core';
import { MultiTenancyModule } from './multi-tenancy.module';
import { TenantContext } from './tenant-context.service';
import type { Actor } from '../authorization/authorization.core';
import type { SqlExecutor, TransactionalDb } from './sql-executor';

function fakeDbReturning(value: string): TransactionalDb {
  const tx: SqlExecutor = { execute: vi.fn().mockResolvedValue({ rows: [{ value }] }) };
  return { transaction: (fn) => fn(tx) };
}

describe('MultiTenancyModule.forRoot — real DI + request-scoped TenantContext', () => {
  it('resolves TenantContext, request-scoped, wired to the default resolver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MultiTenancyModule.forRoot()],
    }).compile();

    const contextId = ContextIdFactory.create();
    const actor: Actor = { id: 'u1', persona: 'issuer', tenantId: 't-1' };
    moduleRef.registerRequestByContextId({ actor }, contextId);

    const tenantContext = await moduleRef.resolve(TenantContext, contextId);
    expect(tenantContext).toBeInstanceOf(TenantContext);

    await expect(tenantContext.run(fakeDbReturning('t-1'), async () => 'ok')).resolves.toBe('ok');
  });

  it('wires a custom scope resolver when scopeResolverToken is supplied', async () => {
    const FAKE_RESOLVER = Symbol('FAKE_RESOLVER');
    const resolve = vi.fn().mockReturnValue({ kind: 'payer', payerId: 'p1' });
    @Module({ providers: [{ provide: FAKE_RESOLVER, useValue: { resolve } }], exports: [FAKE_RESOLVER] })
    class ResolverModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [MultiTenancyModule.forRoot({ scopeResolverToken: FAKE_RESOLVER, imports: [ResolverModule] })],
    }).compile();

    const contextId = ContextIdFactory.create();
    const actor: Actor = { id: 'u1', persona: 'payer', tenantId: null };
    moduleRef.registerRequestByContextId({ actor }, contextId);
    const tenantContext = await moduleRef.resolve(TenantContext, contextId);

    await tenantContext.run(fakeDbReturning('p1'), async () => undefined);
    expect(resolve).toHaveBeenCalledWith(actor);
  });
});
