import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FileAccessEvent, FileAccessRecorder } from '../../file-storage.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { FILE_STORAGE_SQL_EXECUTOR } from '../tokens';

/**
 * Writes one `commons_file_access` row per download URL handed out. Called
 * best-effort by `AttachmentService` — it must be cheap and must not throw in
 * the normal path, but a genuine DB error propagates to the caller's
 * catch-and-ignore.
 */
@Injectable()
export class PostgresFileAccessRecorder implements FileAccessRecorder {
  constructor(@Inject(FILE_STORAGE_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async record(event: FileAccessEvent): Promise<void> {
    await this.db.execute(sql`
      insert into commons_file_access (file_record_id, tenant_id, actor_id, via, purpose, occurred_at)
      values (${event.fileRecordId}, ${event.tenantId}, ${event.actorId}, ${event.via}, ${event.purpose}, ${event.occurredAt})
    `);
  }
}
