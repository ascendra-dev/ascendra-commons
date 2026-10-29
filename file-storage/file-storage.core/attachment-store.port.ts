import type { Attachment } from './attachment.interface';
import type { FileRecord, LegalHold } from './file-record.interface';

/**
 * The persistence port for `FileRecord` + `Attachment`. Atomicity requirements
 * are baked into the method contracts, not left to a transaction handle
 * threaded by the caller — this library never needs to know what "transaction"
 * means for the consumer's database.
 *
 *   - `attach`            — one new FileRecord + its first Attachment, one tx.
 *   - `link`              — another Attachment onto an existing FileRecord.
 *   - `detach`            — remove one Attachment; the FileRecord is retained.
 *   - `setLegalHold`      — place or release a legal hold.
 *   - `deleteFileCascade` — remove a FileRecord and every Attachment, one tx; never a held file.
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

  /** Place (`hold` set) or release (`null`) a legal hold. Returns the updated record, or `null` if it didn't exist. */
  setLegalHold(fileRecordId: string, hold: LegalHold | null): Promise<FileRecord | null>;

  /**
   * Deletes the FileRecord and all its Attachments in one tx — never a held
   * file (nothing is deleted). Leaves the access log. Returns the removed
   * FileRecord (for its `fileRef`), or `null` if it didn't exist or is held.
   */
  deleteFileCascade(fileRecordId: string): Promise<FileRecord | null>;
}
