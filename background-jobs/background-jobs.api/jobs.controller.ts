import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
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

  @Post(':name/run')
  @HttpCode(200)
  @RequiresAction(JOB_ACTIONS.RUN)
  run(@CurrentActor() actor: Actor, @Param('name') name: string) {
    return this.service.trigger(actor, name);
  }
}
