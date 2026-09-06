import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { AuthzAdminPort, AuthzObservabilityPort } from '../authorization.core.permission-table';
import { AUTHZ_ADMIN_PORT, AUTHZ_OBSERVABILITY_PORT } from '../authorization.core.permission-table';
import { PostgresAuthzAdminModule } from './postgres-authz-admin.module';
import { PostgresAuthzAdminService } from './admin/postgres-authz-admin.service';
import { PostgresAuthzObservabilityService } from './admin/postgres-authz-observability.service';

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
  it('binds both ports to the Postgres services, wired to the db token', async () => {
    const { DbModule, execute } = dbModule();
    const moduleRef = await Test.createTestingModule({
      imports: [PostgresAuthzAdminModule.forRoot({ sqlExecutorToken: DB, imports: [DbModule] })],
    }).compile();

    const observability = moduleRef.get<AuthzObservabilityPort>(AUTHZ_OBSERVABILITY_PORT);
    const admin = moduleRef.get<AuthzAdminPort>(AUTHZ_ADMIN_PORT);
    expect(observability).toBeInstanceOf(PostgresAuthzObservabilityService);
    expect(admin).toBeInstanceOf(PostgresAuthzAdminService);

    await observability.listRoles();
    await admin.assignRole({ userId: 'u1', tenantId: 't1', roleId: 'issuer', grantedBy: 'a' });

    expect(execute).toHaveBeenCalled();
    await moduleRef.close();
  });
});
