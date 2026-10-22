import type { DynamicModule } from '@nestjs/common';

/**
 * The `@RequiresAction` gate names `background-jobs.api`'s endpoints declare.
 * Fixed — `@RequiresAction` is applied at class-definition time. Restrict these
 * to an ops / platform-admin persona (a job run is not tenant-scoped — jobs
 * have no `tenantId`).
 */
export const JOB_ACTIONS = {
  /** Read the jobs dashboard + run history. */
  VIEW: 'job.view',
  /** Trigger a job out of schedule (`POST /jobs/:name/run`). */
  RUN: 'job.run',
} as const;

export interface JobsApiModuleConfig {
  /**
   * Modules exporting `JOB_OBSERVABILITY_PORT` and `JobTrigger` (from `PostgresJobObservabilityModule` and
   * `BackgroundJobsModule`) — and, optionally, `JOB_LOCK_INSPECTOR_PORT` (`PostgresLeaseLockInspectorModule`) for
   * `GET /jobs/locks`.
   */
  imports?: DynamicModule['imports'];
  /** Optional token a `JobAuditEmitter` is provided under (bound in `imports`). Omit → manual triggers are not audited. */
  auditEmitterToken?: string | symbol | (new (...args: never[]) => unknown);
}
