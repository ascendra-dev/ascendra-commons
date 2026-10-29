import type { Attachment } from './attachment.interface';
import type { FileRecord } from './file-record.interface';

/**
 * The persistence port for `FileRecord` + `Attachment`. Atomicity requirements
 * are baked into the method contracts, not left to a transaction handle
 * threaded by the caller — this library never needs to know what "transaction"
 * means for the consumer's database.
 *
 *   - `attach`            — one new FileRecord + its first Attachment, one tx.
 *   - `link`              — another Attachment onto an existing FileRecord.
 *   - `detach`            — remove one Attachment; the FileRecord is retained.
 *   - `deleteFileCascade` — remove a FileRecord and every Attachment, one tx.
 */
export interface AttachmentStore {
  attach(input: {
    fileRecord: Omit<FileRecord, 'id' | 'createdAt' | 'legalHold'>;
    attachment: Omit<Attachment, 'id' | 'fileRecordId' | 'createdAt'>;
  }): Promise<{ fileRecord: FileRecord; attachment: Attachment }>;

  link(input: {
    fileRecordId: string;
    attachment: Omit<Attachment, 'id' | 'fileRecordId' | 'createdAt'>;
  }): Promise<Attachment>;

  getFileRecordById(id: string): Promise<FileRecord | null>;

  getAttachmentById(id: string): Promise<Attachment | null>;

  /** An entity's attachments, newest first. `tenantId` set → only that tenant's files (`AttachmentService.listForEntity` always sets it for a tenant actor). */
  findByEntity(
    attachedToType: string,
    attachedToId: string,
    opts?: { tenantId?: string },
  ): Promise<Array<Attachment & { fileRecord: FileRecord }>>;

  detach(attachmentId: string): Promise<void>;

  /** Deletes the FileRecord and all its Attachments in one tx. Returns the removed FileRecord (for its `fileRef`), or `null` if it didn't exist. */
  deleteFileCascade(fileRecordId: string): Promise<FileRecord | null>;
}
