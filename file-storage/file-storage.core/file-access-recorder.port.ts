/**
 * Records that a download URL was handed out for a file — the "who fetched
 * this, when" audit trail. Best-effort: `AttachmentService` never fails a
 * download because the recorder threw.
 *
 * Reads only. Uploads and deletes are carried by the optional
 * `FileStorageAuditEmitter` (as domain audit events), not here.
 */
export interface FileAccessRecorder {
  record(event: FileAccessEvent): Promise<void>;
}

export interface FileAccessEvent {
  fileRecordId: string;
  tenantId: string;
  /** `null` for a signed-link fetch — no authenticated actor, the token is the grant. */
  actorId: string | null;
  via: 'actor' | 'signed-link';
  /** `'in-app'` | `'shareable-link'` — free text, whatever the caller passed. */
  purpose: string;
  occurredAt: Date;
}

export class NoopFileAccessRecorder implements FileAccessRecorder {
  async record(): Promise<void> {}
}
