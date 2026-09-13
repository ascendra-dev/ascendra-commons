import { Controller, Get, Headers, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CurrentActor, RequiresAction, type Actor } from '../../authorization/authorization.core';
import { JOB_ACTIONS } from './jobs-api.options';
import { JobsApiService } from './jobs-api.service';
import type { JobRunOutcome } from '../background-jobs.core';

/**
 * The jobs dashboard + run-history reads, and the "run now" / "retry" trigger.
 * Reads gated on `job.view`, the trigger on `job.run`. Requires
 * `AuthorizationGuard` wired globally as `APP_GUARD` (see `authorization.core`'s
 * README). No tenant scoping — jobs have no `tenantId`.
 */
@Controller('jobs')
export class JobsController {
  constructor(@Inject(JobsApiService) private readonly service: JobsApiService) {}

  @Get()
  @RequiresAction(JOB_ACTIONS.VIEW)
  dashboard() {
    return this.service.listJobStatus();
  }

  @Get(':name/runs')
  @RequiresAction(JOB_ACTIONS.VIEW)
  runs(
    @Param('name') name: string,
    @Query('outcome') outcome?: JobRunOutcome,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.getRunHistory({
      jobName: name,
      outcome,
      since,
      until,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('runs/trace/:correlationId')
  @RequiresAction(JOB_ACTIONS.VIEW)
  trace(
    @Param('correlationId') correlationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.getTrace(correlationId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  /** The run-detail permalink — full untruncated `error`, unlike the list rows above. 404 if no such run. */
  @Get('runs/:id')
  @RequiresAction(JOB_ACTIONS.VIEW)
  runDetail(@Param('id') id: string) {
    return this.service.getRun(id);
  }

  /** "Chronic offender" items for one job — see `JobObservabilityPort.getFailedItems`'s doc comment for the best-effort caveat. */
  @Get(':name/failed-items')
  @RequiresAction(JOB_ACTIONS.VIEW)
  failedItems(@Param('name') name: string, @Query('minRuns') minRuns?: string) {
    return this.service.getFailedItems(name, minRuns !== undefined ? Number(minRuns) : undefined);
  }

  /** The dashboard filtered to jobs needing attention (overdue and/or repeated failures). Read-only — no ack, no webhook. */
  @Get('alerts')
  @RequiresAction(JOB_ACTIONS.VIEW)
  alerts() {
    return this.service.getAlerts();
  }

  @Post(':name/run')
  @HttpCode(200)
  @RequiresAction(JOB_ACTIONS.RUN)
  run(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    // Same header (`x-correlation-id`) audit-logging's own CorrelationIdMiddleware reads —
    // reused by convention, not by dependency: this module stays self-contained (no import
    // from audit-logging), but the two naturally agree when both are wired in the same app.
    // Generated fresh when the caller didn't supply one, so every manual run is traceable.
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.service.trigger(actor, name, correlationId ?? randomUUID());
  }
}
