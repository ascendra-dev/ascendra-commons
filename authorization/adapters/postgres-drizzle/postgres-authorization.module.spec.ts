import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthorizationModule } from '../../authorization.module';
import { AUTHORIZER } from '../../tokens';
import { computeSessionSnapshot } from '../../session-snapshot';
import type { Authorizer } from '../../authorizer';
import { PostgresAuthorizationModule } from './postgres-authorization.module';
import { AUTHZ_DELEGATION_SERVICE, POSTGRES_PERMISSION_TABLE_AUTHORIZER } from './tokens';
import { DelegationService } from './delegation.service';

const DB = Symbol('DB');

function dbModule(rows: unknown[] = []) {
  const execute = vi.fn().mockResolvedValue({ rows });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class FakeDbModule {}
  return { FakeDbModule, execute };
}

async function build(rows: unknown[] = []) {
  const { FakeDbModule, execute } = dbModule(rows);
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthorizationModule.forRoot({
        model: 'permission-table',
        authorizerToken: POSTGRES_PERMISSION_TABLE_AUTHORIZER,
        imports: [PostgresAuthorizationModule.forRoot({ sqlExecutorToken: DB, imports: [FakeDbModule] })],
      }),
    ],
  }).compile();
  return { moduleRef, execute };
}

describe('PostgresAuthorizationModule wired into AuthorizationModule', () => {
  it('binds AUTHORIZER to the Postgres authorizer, aliased to the consumer db token', async () => {
    const { moduleRef, execute } = await build([{ action: 'invoice.view', grants_all: false }]);
    const authorizer = moduleRef.get<Authorizer>(AUTHORIZER);

    await expect(authorizer.can({ id: 'u1', persona: 'issuer', tenantId: 't1' }, 'invoice.view')).resolves.toBe(true);
    expect(execute).toHaveBeenCalled(); // reached the fake db → wiring resolved
    await moduleRef.close();
  });

  it('the bound authorizer implements allowedActions, so computeSessionSnapshot uses the one-query path', async () => {
    const { moduleRef, execute } = await build([{ action: 'invoice.view', grants_all: false }]);
    const authorizer = moduleRef.get<Authorizer>(AUTHORIZER);
    expect(typeof authorizer.allowedActions).toBe('function');

    const snap = await computeSessionSnapshot(
      { id: 'u1', persona: 'issuer', tenantId: 't1' },
      ['invoice.view', 'invoice.void', 'payment.refund'],
      authorizer,
    );

    expect(snap.allowedActions).toEqual(['invoice.view']);
    // one role query + one delegation query, not one-per-action
    expect(execute.mock.calls.length).toBeLessThanOrEqual(2);
    await moduleRef.close();
  });

  it('exports the delegation service', async () => {
    const { moduleRef } = await build();
    expect(moduleRef.get(AUTHZ_DELEGATION_SERVICE)).toBeInstanceOf(DelegationService);
    await moduleRef.close();
  });
});
