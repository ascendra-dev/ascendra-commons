import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { isUuid, type PendingUpload, type PendingUploadStore } from '../../file-storage.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { FILE_STORAGE_SQL_EXECUTOR } from '../tokens';

const toPending = (r: Record<string, unknown>): PendingUpload => ({
  id: r.id as string,
  tenantId: r.tenant_id as string,
  actorId: r.actor_id as string,
  category: r.category as string,
  attachedToType: r.attached_to_type as string,
  attachedToId: r.attached_to_id as string,
  filename: r.filename as string,
  contentType: r.content_type as string,
  sizeBytes: Number(r.size_bytes),
  fileRef: r.file_ref as string,
  expiresAt: new Date(r.expires_at as string),
  createdAt: new Date(r.created_at as string),
});

/** `PendingUploadStore` on Postgres — `commons_file_pending_upload` (migration 0008). */
@Injectable()
export class PostgresPendingUploadStore implements PendingUploadStore {
  constructor(@Inject(FILE_STORAGE_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async create(u: Omit<PendingUpload, 'id' | 'createdAt'>): Promise<PendingUpload> {
    const { rows } = await this.db.execute(sql`
      insert into commons_file_pending_upload
        (tenant_id, actor_id, category, attached_to_type, attached_to_id, filename, content_type, size_bytes, file_ref, expires_at)
      values
        (${u.tenantId}, ${u.actorId}, ${u.category}, ${u.attachedToType}, ${u.attachedToId}, ${u.filename}, ${u.contentType},
         ${u.sizeBytes}, ${u.fileRef}, ${u.expiresAt})
      returning *
    `);
    return toPending(rows[0]);
  }

  /** An id that isn't a uuid names no upload — `null`, not a driver error. */
  async get(id: string): Promise<PendingUpload | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.db.execute(sql`select * from commons_file_pending_upload where id = ${id}`);
    return rows[0] ? toPending(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { rows } = await this.db.execute(sql`delete from commons_file_pending_upload where id = ${id} returning id`);
    return rows.length > 0;
  }

  async findExpired(now: Date, limit: number): Promise<PendingUpload[]> {
    const { rows } = await this.db.execute(sql`
      select * from commons_file_pending_upload where expires_at <= ${now} order by expires_at limit ${limit}
    `);
    return rows.map(toPending);
  }
}
