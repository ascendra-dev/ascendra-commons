import type { Attachment } from './attachment.interface';
import type { FileRecord } from './file-record.interface';

/**
 * The persistence port for FileRecord + Attachment. One method, not two
 * separate repositories with a transaction handle threaded between them —
 * attach() bundles the atomicity requirement (a FileRecord with no
 * Attachment would be a real bug) into the contract itself, so the
 * implementation owns wrapping both writes in one transaction internally.
 * This library never needs to know or care what "transaction" means for
 * whatever database the consumer uses.
 */
export interface AttachmentStore {
  attach(input: {
    fileRecord: Omit<FileRecord, 'id' | 'createdAt'>;
    attachment: Omit<Attachment, 'fileRecordId'>;
  }): Promise<{ fileRecord: FileRecord; attachment: Attachment }>;

  findByEntity(
    attachedToType: string,
    attachedToId: string,
  ): Promise<Array<Attachment & { fileRecord: FileRecord }>>;
}
