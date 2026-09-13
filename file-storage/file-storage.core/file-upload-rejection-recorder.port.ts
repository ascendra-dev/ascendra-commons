/**
 * Records that an upload attempt was refused — a bad/unavailable category, a
 * validation-rule violation, or a failed (or unscannable-and-rejected) malware
 * scan. The "why do uploads keep failing" support/ops trail. Best-effort:
 * `AttachmentService` never changes or fails the rejection response because
 * the recorder itself threw.
 *
 * No blob is ever written for a rejection — metadata only, and only the three
 * `AttachmentService.attach()` throw sites above call it (not, for example,
 * the no-tenant-context check, which has no tenant to scope the row to).
 */
export interface FileUploadRejectionRecorder {
  record(event: FileUploadRejectionEvent): Promise<void>;
}

export type FileUploadRejectionReason = 'category-unavailable' | 'validation-failed' | 'scan-rejected';

export interface FileUploadRejectionEvent {
  tenantId: string;
  actorId: string;
  /** The requested `FileCategory` key — may not resolve to a real/active category. */
  category: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  reason: FileUploadRejectionReason;
  message: string;
  occurredAt: Date;
}

export class NoopFileUploadRejectionRecorder implements FileUploadRejectionRecorder {
  async record(): Promise<void> {}
}
