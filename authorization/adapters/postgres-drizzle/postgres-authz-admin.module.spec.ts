import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresAuthzAdminModule } from './postgres-authz-admin.module';
import { PostgresAuthzAdminService } from './authz-admin.service';
import { PostgresAuthzObservabilityService } from './authz-observability.service';
import { POSTGRES_AUTHZ_ADMIN, POSTGRES_AUTHZ_OBSERVABILITY } from './tokens';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    return { rows: /from commons_authz_role\b/i.test(text) ? [{ id: 'issuer' }] : [] };
  });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresAuthzAdminModule', () => {
  it('resolves both the observability and admin services wired to the db token', async () => {
    const { DbModule, execute } = dbModule();
    const moduleRef = await Test.createTestingModule({
      imports: [PostgresAuthzAdminModule.forRoot({ sqlExecutorToken: DB, imports: [DbModule] })],
    }).compile();

    expect(moduleRef.get(POSTGRES_AUTHZ_OBSERVABILITY)).toBeInstanceOf(PostgresAuthzObservabilityService);
    expect(moduleRef.get(POSTGRES_AUTHZ_ADMIN)).toBeInstanceOf(PostgresAuthzAdminService);

    await moduleRef.get<PostgresAuthzObservabilityService>(POSTGRES_AUTHZ_OBSERVABILITY).listRoles();
    await moduleRef
      .get<PostgresAuthzAdminService>(POSTGRES_AUTHZ_ADMIN)
      .assignRole({ userId: 'u1', tenantId: 't1', roleId: 'issuer', grantedBy: 'a' });

    expect(execute).toHaveBeenCalled();
  });
});
