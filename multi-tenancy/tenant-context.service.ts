import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Actor } from '../authorization/authorization.core';
import type { TenantScopeResolver } from './tenant-scope-resolver';
import type { SqlExecutor, TransactionalDb } from './sql-executor';
import { withTenantContext } from './with-tenant-context';
import { TENANT_SCOPE_RESOLVER } from './tokens';

interface RequestWithActor {
  actor: Actor;
}

/**
 * Request-scoped — one instance per request, reading the actor already
 * established earlier in the pipeline by the auth guard. Every repository
 * method rides on `run()`, never manages `set_config()`/transactions itself.
 *
 * ```typescript
 * async findById(id: string) {
 *   return this.tenantContext.run(this.db, (tx) =>
 *     tx.select().from(invoice).where(eq(invoice.id, id))); // RLS applies the tenant filter, not this WHERE clause
 * }
 * ```
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  constructor(
    @Inject(REQUEST) private readonly request: RequestWithActor,
    @Inject(TENANT_SCOPE_RESOLVER) private readonly resolver: TenantScopeResolver,
  ) {}

  async run<T>(db: TransactionalDb, fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return withTenantContext(db, this.resolver.resolve(this.request.actor), fn);
  }
}
