import type { Attachment, FileRecord } from '../../file-storage.core';

/** `db.execute` returns raw snake_case rows with driver-dependent scalar types — normalise here. */

export function toFileRecord(r: Record<string, unknown>): FileRecord {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    fileRef: r.file_ref as string,
    category: r.category as string,
    contentType: r.content_type as string,
    sizeBytes: Number(r.size_bytes),
    contentHash: (r.content_hash as string | null) ?? null,
    uploadedBy: r.uploaded_by as string,
    filename: (r.filename as string | null) ?? null,
    scanVerdict: (r.scan_verdict as 'clean' | 'unscannable' | null) ?? null,
    retainUntil: r.retain_until ? new Date(r.retain_until as string) : null,
    legalHold: r.held_at
      ? { heldAt: new Date(r.held_at as string), heldBy: r.held_by as string, reason: (r.hold_reason as string | null) ?? '' }
      : null,
    createdAt: new Date(r.created_at as string),
  };
}

export function toAttachment(r: Record<string, unknown>): Attachment {
  return {
    id: r.id as string,
    fileRecordId: r.file_record_id as string,
    attachedToType: r.attached_to_type as string,
    attachedToId: r.attached_to_id as string,
    category: r.category as string,
    createdAt: new Date(r.created_at as string),
  };
}
