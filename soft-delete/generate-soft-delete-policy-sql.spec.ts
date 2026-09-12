import { describe, expect, it } from 'vitest';
import { generateSoftDeletePolicySql } from './generate-soft-delete-policy-sql';

describe('generateSoftDeletePolicySql', () => {
  it('enables RLS and creates a SELECT policy scoped by deleted_at alone when no scoping predicate is given', () => {
    const sql = generateSoftDeletePolicySql('invoice');

    expect(sql).toContain('alter table invoice enable row level security;');
    expect(sql).toMatch(/create policy invoice_select on invoice for select/);
    expect(sql).toMatch(/using \(\s*deleted_at is null\s*\);/);
  });

  it('the UPDATE policy USING repeats deleted_at is null, but WITH CHECK does not — the split that makes the delete itself succeed', () => {
    const sql = generateSoftDeletePolicySql('invoice');
    const updateBlock = sql.slice(sql.indexOf('create policy invoice_update'));

    expect(updateBlock).toMatch(/using \(\s*deleted_at is null\s*\)/);
    const withCheckBlock = updateBlock.slice(updateBlock.indexOf('with check'));
    expect(withCheckBlock).not.toContain('deleted_at');
  });

  it('composes a caller-supplied scoping predicate into all three predicate positions except the bare WITH CHECK default', () => {
    const sql = generateSoftDeletePolicySql('invoice', { scopingPredicateSql: 'tenant_id = current_setting(...)' });

    expect(sql).toContain('deleted_at is null\n    and (tenant_id = current_setting(...))');
    // WITH CHECK gets the scoping predicate alone — no deleted_at repeated (see the "why" test above).
    const withCheckBlock = sql.slice(sql.indexOf('with check'));
    expect(withCheckBlock).toContain('tenant_id = current_setting(...)');
    expect(withCheckBlock).not.toContain('deleted_at');
  });

  it('rejects a table name that is not a plain SQL identifier', () => {
    expect(() => generateSoftDeletePolicySql('invoice; drop table invoice; --')).toThrow(/not a valid SQL identifier/);
  });

  it('derives both policy names from the table name', () => {
    const sql = generateSoftDeletePolicySql('payment');
    expect(sql).toContain('payment_select');
    expect(sql).toContain('payment_update');
  });
});
