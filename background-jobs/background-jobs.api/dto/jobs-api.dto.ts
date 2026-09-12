import type { JobRunOutcome } from '../../background-jobs.core';

/**
 * Request shapes for `background-jobs.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. The controller reads query strings; the `.api`
 * service parses dates.
 */
export interface RunHistoryQueryDto {
  jobName?: string;
  outcome?: JobRunOutcome;
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}
