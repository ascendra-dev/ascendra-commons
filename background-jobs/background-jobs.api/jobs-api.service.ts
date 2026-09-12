import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';
import {
  JOB_OBSERVABILITY_PORT,
  JobTrigger,
  type JobObservabilityPort,
  type JobTriggerResult,
  type RunHistoryPage,
} from '../background-jobs.core';
import { JOB_AUDIT_EMITTER } from './tokens';
import type { JobAuditEmitter } from './job-audit.port';
import type { RunHistoryQueryDto } from './dto/jobs-api.dto';

/**
 * Thin orchestration over `JobObservabilityPort` (reads) and `JobTrigger` (the
 * one action). No tenant scoping — `background-jobs` has no `tenantId`. Date
 * params are parsed here; the manual trigger emits an audit event through the
 * optional emitter.
 */
@Injectable()
export class JobsApiService {
  constructor(
    @Inject(JOB_OBSERVABILITY_PORT) private readonly observability: JobObservabilityPort,
    @Inject(JobTrigger) private readonly jobTrigger: JobTrigger,
    @Inject(JOB_AUDIT_EMITTER) private readonly audit: JobAuditEmitter,
  ) {}

  listJobStatus() {
    return this.observability.listJobStatus();
  }

  getRunHistory(query: RunHistoryQueryDto): Promise<RunHistoryPage> {
    return this.observability.getRunHistory({
      jobName: query.jobName,
      outcome: query.outcome,
      correlationId: query.correlationId,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  getTrace(correlationId: string, query: RunHistoryQueryDto): Promise<RunHistoryPage> {
    return this.getRunHistory({ ...query, correlationId });
  }

  async trigger(actor: Actor, jobName: string): Promise<JobTriggerResult> {
    const result = await this.jobTrigger.trigger(jobName);
    await this.audit.record({ action: 'job.triggered', actorId: actor.id, jobName, result: result.status });
    return result;
  }
}
