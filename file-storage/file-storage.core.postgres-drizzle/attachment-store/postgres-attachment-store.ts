import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Attachment, AttachmentStore, FileRecord } from '../../file-storage.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { toAttachment, toFileRecord } from '../persistence/row-mappers';
import { FILE_STORAGE_SQL_EXECUTOR } from '../tokens';

/**
 * `AttachmentStore` on Postgres/Drizzle. Corresponding tables:
 * `persistence/file-record.schema.ts` + `attachment.schema.ts` (+ their
 * migrations).
 *
 * `attach` and `deleteFileCascade` each run as **one** writable-CTE statement,
 * so they're atomic without the adapter ever touching a transaction handle —
 * the minimal `SqlExecutor` shape has no `transaction()`.
 */
@Injectable()
export class PostgresAttachmentStore implements AttachmentStore {
  constructor(@Inject(FILE_STORAGE_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async attach(input: {
    fileRecord: Omit<FileRecord, 'id' | 'createdAt' | 'legalHold'>;
    attachment: Omit<Attachment, 'id' | 'fileRecordId' | 'createdAt'>;
  }): Promise<{ fileRecord: FileRecord; attachment: Attachment }> {
    const fr = input.fileRecord;
    const at = input.attachment;
    const { rows } = await this.db.execute(sql`
      with fr as (
        insert into commons_file_record
          (tenant_id, file_ref, category, content_type, size_bytes, content_hash, uploaded_by,
           filename, scan_verdict, retain_until)
        values
          (${fr.tenantId}, ${fr.fileRef}, ${fr.category}, ${fr.contentType}, ${fr.sizeBytes}, ${fr.contentHash}, ${fr.uploadedBy},
           ${fr.filename}, ${fr.scanVerdict}, ${fr.retainUntil})
        returning *
      ), at as (
        insert into commons_attachment (file_record_id, attached_to_type, attached_to_id, category)
        select fr.id, ${at.attachedToType}, ${at.attachedToId}, ${at.category} from fr
        returning *
      )
      select
        fr.id as fr_id, fr.tenant_id, fr.file_ref, fr.category as fr_category, fr.content_type,
        fr.size_bytes, fr.content_hash, fr.uploaded_by, fr.created_at as fr_created_at,
        fr.filename, fr.scan_verdict, fr.retain_until, fr.held_at, fr.held_by, fr.hold_reason,
        at.id as at_id, at.file_record_id, at.attached_to_type, at.attached_to_id,
        at.category as at_category, at.created_at as at_created_at
      from fr, at
    `);
    const row = rows[0];
    return {
      fileRecord: toFileRecord({
        id: row.fr_id,
        tenant_id: row.tenant_id,
        file_ref: row.file_ref,
        category: row.fr_category,
        content_type: row.content_type,
        size_bytes: row.size_bytes,
        content_hash: row.content_hash,
        uploaded_by: row.uploaded_by,
        filename: row.filename,
        scan_verdict: row.scan_verdict,
        retain_until: row.retain_until,
        held_at: row.held_at,
        held_by: row.held_by,
        hold_reason: row.hold_reason,
        created_at: row.fr_created_at,
      }),
      attachment: toAttachment({
        id: row.at_id,
        file_record_id: row.file_record_id,
        attached_to_type: row.attached_to_type,
        attached_to_id: row.attached_to_id,
        category: row.at_category,
        created_at: row.at_created_at,
      }),
    };
  }

  async link(input: {
    fileRecordId: string;
    attachment: Omit<Attachment, 'id' | 'fileRecordId' | 'createdAt'>;
  }): Promise<Attachment> {
    const at = input.attachment;
    const { rows } = await this.db.execute(sql`
      insert into commons_attachment (file_record_id, attached_to_type, attached_to_id, category)
      values (${input.fileRecordId}, ${at.attachedToType}, ${at.attachedToId}, ${at.category})
      returning *
    `);
    return toAttachment(rows[0]);
  }

  async getFileRecordById(id: string): Promise<FileRecord | null> {
    const { rows } = await this.db.execute(sql`select * from commons_file_record where id = ${id}`);
    return rows[0] ? toFileRecord(rows[0]) : null;
  }

  async getAttachmentById(id: string): Promise<Attachment | null> {
    const { rows } = await this.db.execute(sql`select * from commons_attachment where id = ${id}`);
    return rows[0] ? toAttachment(rows[0]) : null;
  }

  async findByEntity(
    attachedToType: string,
    attachedToId: string,
    opts: { tenantId?: string } = {},
  ): Promise<Array<Attachment & { fileRecord: FileRecord }>> {
    const { rows } = await this.db.execute(sql`
      select
        a.id as a_id, a.file_record_id, a.attached_to_type, a.attached_to_id,
        a.category as a_category, a.created_at as a_created_at,
        f.id as f_id, f.tenant_id, f.file_ref, f.category as f_category, f.content_type,
        f.size_bytes, f.content_hash, f.uploaded_by, f.created_at as f_created_at,
        f.filename, f.scan_verdict, f.retain_until, f.held_at, f.held_by, f.hold_reason
      from commons_attachment a
      join commons_file_record f on f.id = a.file_record_id
      where a.attached_to_type = ${attachedToType} and a.attached_to_id = ${attachedToId}
        ${opts.tenantId !== undefined ? sql`and f.tenant_id = ${opts.tenantId}` : sql``}
      order by a.created_at desc
    `);
    return rows.map((r) => ({
      ...toAttachment({
        id: r.a_id,
        file_record_id: r.file_record_id,
        attached_to_type: r.attached_to_type,
        attached_to_id: r.attached_to_id,
        category: r.a_category,
        created_at: r.a_created_at,
      }),
      fileRecord: toFileRecord({
        id: r.f_id,
        tenant_id: r.tenant_id,
        file_ref: r.file_ref,
        category: r.f_category,
        content_type: r.content_type,
        size_bytes: r.size_bytes,
        content_hash: r.content_hash,
        uploaded_by: r.uploaded_by,
        filename: r.filename,
        scan_verdict: r.scan_verdict,
        retain_until: r.retain_until,
        held_at: r.held_at,
        held_by: r.held_by,
        hold_reason: r.hold_reason,
        created_at: r.f_created_at,
      }),
    }));
  }

  async detach(attachmentId: string): Promise<void> {
    await this.db.execute(sql`delete from commons_attachment where id = ${attachmentId}`);
  }

  async deleteFileCascade(fileRecordId: string): Promise<FileRecord | null> {
    const { rows } = await this.db.execute(sql`
      with del_attach as (delete from commons_attachment where file_record_id = ${fileRecordId} returning 1)
      delete from commons_file_record where id = ${fileRecordId}
      returning *
    `);
    return rows[0] ? toFileRecord(rows[0]) : null;
  }
}
