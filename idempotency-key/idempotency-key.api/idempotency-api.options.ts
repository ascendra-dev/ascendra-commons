import type { DynamicModule } from '@nestjs/common';

/**
 * The `@RequiresAction` gate name `idempotency-key.api`'s endpoints declare.
 * Fixed — `@RequiresAction` is applied at class-definition time. Restrict this
 * to an ops / support persona — a claim's `scope` is whatever the app's
 * `IdempotencyScopeResolver` returns (usually a tenant/actor id), but this API
 * does not itself enforce a caller-vs-scope match (see the module README).
 */
export const IDEMPOTENCY_ACTIONS = {
  /** Read claims and the health summary. */
  VIEW: 'idempotency.view',
} as const;

export interface IdempotencyApiModuleConfig {
  /** Modules exporting `IDEMPOTENCY_OBSERVABILITY_PORT` (a stack adapter's `PostgresIdempotencyObservabilityModule`). */
  imports?: DynamicModule['imports'];
}
