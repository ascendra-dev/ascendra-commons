/**
 * Request shapes for `domain-events.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. The controller reads query strings; the `.api`
 * service parses dates.
 */
export interface DeliveryQueryDto {
  eventName?: string;
  method?: 'emit' | 'emitCritical';
  status?: 'delivered' | 'no_listeners' | 'dispatch_failed';
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
}
