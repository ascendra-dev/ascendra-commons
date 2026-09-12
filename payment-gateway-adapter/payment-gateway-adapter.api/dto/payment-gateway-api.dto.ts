/** Request shape for `payment-gateway-adapter.api`. Plain interface — this library carries no validation library. */
export interface WebhookEventQueryDto {
  gateway?: string;
  outcome?: 'applied' | 'duplicate' | 'ignored_backwards' | 'signature_invalid';
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}
