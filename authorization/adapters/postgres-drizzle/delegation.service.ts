import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Actor } from '../../authorization.types';
import { PermissionLoader } from './permission-loader';
import { textArray } from './sql-helpers';
import type { SqlExecutor } from './sql-executor';
import { AUTHZ_DELEGATION_OPTIONS, AUTHZ_SQL_EXECUTOR } from './tokens';

export interface DelegationOptions {
  /** Hard cap on how far out `expiresAt` may be set. No indefinite delegations. */
  maxDelegationDays: number;
}

export interface CreateDelegationInput {
  granterId: string;
  granteeId: string;
  tenantId: string;
  actions: string[];
  expiresAt: Date;
  reason?: string;
  /** Who initiated it — normally the granter; an admin id if admin-initiated. Defaults to `granterId`. */
  createdBy?: string;
}

export interface DelegationRecord {
  id: string;
  granterId: string;
  granteeId: string;
  tenantId: string;
  actions: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  reason: string | null;
  createdAt: Date;
  status: 'active' | 'expired' | 'revoked';
}

/** Thrown when a granter tries to delegate actions they don't hold from their own roles. */
export class CannotDelegateError extends Error {
  constructor(public readonly missingActions: string[]) {
    super(`Cannot delegate action(s) the granter does not hold from their roles: ${missingActions.join(', ')}`);
    this.name = 'CannotDelegateError';
  }
}

/** Thrown when `expiresAt` is missing, in the past, or beyond `maxDelegationDays`. */
export class InvalidDelegationExpiryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDelegationExpiryError';
  }
}

/**
 * Minimal delegation (v1): a user grants a subset of their own role-derived
 * actions to another user, within one tenant, time-boxed and revocable.
 *
 * **Snapshot model** — `actions` is fixed at grant time. If the granter later
 * loses one of those actions, the delegation keeps carrying it until it expires
 * or is revoked; the mandatory capped `expiresAt` plus one-call revoke are what
 * bound that. The adapter README lists what the snapshot model defers (live
 * re-check, cascade-on-revoke, chains, resource scoping, approvals).
 *
 * Chains are blocked by construction: the grant-time check reads the granter's
 * **role** permissions only (`PermissionLoader.rolePermissions`), never their
 * delegated-in ones — so a delegated action can't itself be re-delegated.
 *
 * Audit is the consumer's to wire — call this from a controller and emit an
 * `AuditRecordRaised` there (see the adapter README); this service takes no
 * dependency on the audit-logging module.
 */
@Injectable()
export class DelegationService {
  constructor(
    @Inject(AUTHZ_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(AUTHZ_DELEGATION_OPTIONS) private readonly options: DelegationOptions,
    @Inject(PermissionLoader) private readonly loader: PermissionLoader,
  ) {}

  async delegate(input: CreateDelegationInput): Promise<DelegationRecord> {
    if (input.actions.length === 0) {
      throw new CannotDelegateError([]);
    }
    this.assertExpiry(input.expiresAt);

    const granter: Actor = { id: input.granterId, persona: '', tenantId: input.tenantId };
    const rolePerms = await this.loader.rolePermissions(granter);
    if (!rolePerms.grantsAll) {
      const missing = input.actions.filter((a) => !rolePerms.actions.has(a));
      if (missing.length > 0) throw new CannotDelegateError(missing);
    }

    const { rows } = await this.db.execute<DelegationRow>(sql`
      INSERT INTO authz_delegation (granter_id, grantee_id, tenant_id, actions, expires_at, reason, created_by)
      VALUES (
        ${input.granterId}, ${input.granteeId}, ${input.tenantId}, ${textArray(input.actions)},
        ${input.expiresAt}, ${input.reason ?? null}, ${input.createdBy ?? input.granterId}
      )
      RETURNING id, granter_id, grantee_id, tenant_id, actions, expires_at, revoked_at, reason, created_at
    `);
    return toRecord(rows[0]);
  }

  /** Sets `revoked_at` if the delegation is still active. Idempotent — revoking an already-revoked row is a no-op. */
  async revokeDelegation(id: string, revokedBy: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE authz_delegation SET revoked_at = now(), revoked_by = ${revokedBy}
      WHERE id = ${id} AND revoked_at IS NULL
    `);
  }

  /** Delegations this actor granted and delegations granted to them, in this tenant, newest first. */
  async listDelegations(actor: Actor): Promise<{ granted: DelegationRecord[]; received: DelegationRecord[] }> {
    const { rows } = await this.db.execute<DelegationRow & { granter_id: string; grantee_id: string }>(sql`
      SELECT id, granter_id, grantee_id, tenant_id, actions, expires_at, revoked_at, reason, created_at
      FROM authz_delegation
      WHERE tenant_id = ${actor.tenantId}
        AND (granter_id = ${actor.id} OR grantee_id = ${actor.id})
      ORDER BY created_at DESC
    `);
    const records = rows.map(toRecord);
    return {
      granted: records.filter((r) => r.granterId === actor.id),
      received: records.filter((r) => r.granteeId === actor.id),
    };
  }

  private assertExpiry(expiresAt: Date): void {
    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
      throw new InvalidDelegationExpiryError('expiresAt is required and must be a valid Date');
    }
    if (expiresAt.getTime() <= Date.now()) {
      throw new InvalidDelegationExpiryError('expiresAt must be in the future');
    }
    const maxMs = this.options.maxDelegationDays * 24 * 60 * 60 * 1000;
    if (expiresAt.getTime() > Date.now() + maxMs) {
      throw new InvalidDelegationExpiryError(`expiresAt is beyond the ${this.options.maxDelegationDays}-day maximum`);
    }
  }
}

interface DelegationRow {
  id: string;
  granter_id: string;
  grantee_id: string;
  tenant_id: string;
  actions: string[];
  expires_at: string | Date;
  revoked_at: string | Date | null;
  reason: string | null;
  created_at: string | Date;
}

function toRecord(row: DelegationRow): DelegationRecord {
  const expiresAt = new Date(row.expires_at);
  const revokedAt = row.revoked_at === null ? null : new Date(row.revoked_at);
  const status: DelegationRecord['status'] = revokedAt
    ? 'revoked'
    : expiresAt.getTime() <= Date.now()
      ? 'expired'
      : 'active';
  return {
    id: row.id,
    granterId: row.granter_id,
    granteeId: row.grantee_id,
    tenantId: row.tenant_id,
    actions: row.actions,
    expiresAt,
    revokedAt,
    reason: row.reason,
    createdAt: new Date(row.created_at),
    status,
  };
}
