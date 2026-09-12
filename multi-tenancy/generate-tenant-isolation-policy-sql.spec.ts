import { describe, expect, it } from 'vitest';
import { generateTenantIsolationPolicySql, tenantIsolationPredicateSql } from './generate-tenant-isolation-policy-sql';

describe('tenantIsolationPredicateSql', () => {
  it('includes the tenant and admin branches by default', () => {
    const predicate = tenantIsolationPredicateSql();
    expect(predicate).toContain("tenant_id = current_setting('app.current_tenant_id', true)::uuid");
    expect(predicate).toContain("current_setting('app.is_admin', true) = 'true'");
    expect(predicate).not.toContain('payer_id');
  });

  it('includes the payer branch only when requested', () => {
    const predicate = tenantIsolationPredicateSql({ includePayerBranch: true });
    expect(predicate).toContain("payer_id = current_setting('app.current_payer_id', true)::uuid");
  });
});

describe('generateTenantIsolationPolicySql', () => {
  it('enables RLS and creates one policy using the predicate', () => {
    const sql = generateTenantIsolationPolicySql('invoice');

    expect(sql).toContain('alter table invoice enable row level security;');
    expect(sql).toMatch(/create policy invoice_tenant_isolation on invoice/);
    expect(sql).toContain(tenantIsolationPredicateSql());
  });

  it('rejects a table name that is not a plain SQL identifier', () => {
    expect(() => generateTenantIsolationPolicySql('invoice; drop table invoice; --')).toThrow(
      /not a valid SQL identifier/,
    );
  });
});
