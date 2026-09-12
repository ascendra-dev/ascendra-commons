/** Request shape for `rate-limiting.api`. Plain interface — this library carries no validation library. */
export interface RejectionQueryDto {
  route?: string;
  identifier?: string;
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}
