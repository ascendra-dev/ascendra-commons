import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';
import {
  JOB_OBSERVABILITY_PORT,
  JobTrigger,
  type FailedItemSummary,
  type JobObservabilityPort,
  type JobRunRecord,
  type JobStatus,
  type JobTriggerResult,
  type RunHistoryPage,
} from '../background-jobs.core';
import { JOB_AUDIT_EMITTER } from './tokens';
import type { JobAuditEmitter } from './job-audit.port';
import type { RunHistoryQueryDto } from './dto/jobs-api.dto';

/**
 * A job on the dashboard is surfaced as an alert once it's overdue, or once it
 * has this many (or more) consecutive failed runs. A pure filter over
 * `listJobStatus()` — no new persistence, no ack state (deferred; see
 * `mocks.html`'s Alerts & Overdue screen).
 */
const ALERT_CONSECUTIVE_FAILURES_THRESHOLD = 2;

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

  /**
   * @param correlationId  forwarded to `JobTrigger.trigger()` so the run lands
   *   tagged for `getTrace()` — the controller supplies this (from an inbound
   *   `X-Correlation-Id` header, or a freshly generated one).
   */
  async trigger(actor: Actor, jobName: string, correlationId?: string): Promise<JobTriggerResult> {
    const result = await this.jobTrigger.trigger(jobName, correlationId);
    await this.audit.record({ action: 'job.triggered', actorId: actor.id, jobName, result: result.status });
    return result;
  }

  async getRun(id: string): Promise<JobRunRecord> {
    const run = await this.observability.getRun(id);
    if (!run) throw new NotFoundException();
    return run;
  }

  getFailedItems(jobName: string, minRuns?: number): Promise<FailedItemSummary[]> {
    return this.observability.getFailedItems(jobName, minRuns);
  }

  /** The dashboard, filtered to jobs that need an operator's attention. Read-only — no ack state, no webhook (deferred). */
  async getAlerts(): Promise<JobStatus[]> {
    const statuses = await this.observability.listJobStatus();
    return statuses.filter((s) => s.overdue || s.consecutiveFailures >= ALERT_CONSECUTIVE_FAILURES_THRESHOLD);
  }
}
