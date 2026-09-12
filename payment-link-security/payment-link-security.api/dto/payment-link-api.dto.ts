/** Request shape for `payment-link-security.api`. Plain interface — this library carries no validation library. */
export interface ResolutionQueryDto {
  outcome?: 'resolved' | 'not_found' | 'revoked';
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}
