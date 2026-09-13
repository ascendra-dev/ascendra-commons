import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FileUploadRejectionEvent, FileUploadRejectionRecorder } from '../../file-storage.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { FILE_STORAGE_SQL_EXECUTOR } from '../tokens';

/**
 * Writes one `commons_file_rejection` row per upload attempt
 * `AttachmentService.attach` refused. Called best-effort by
 * `AttachmentService` — it must be cheap and must not throw in the normal
 * path, but a genuine DB error propagates to the caller's catch-and-ignore.
 */
@Injectable()
export class PostgresFileUploadRejectionRecorder implements FileUploadRejectionRecorder {
  constructor(@Inject(FILE_STORAGE_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async record(event: FileUploadRejectionEvent): Promise<void> {
    await this.db.execute(sql`
      insert into commons_file_rejection
        (tenant_id, actor_id, category, filename, content_type, size_bytes, reason, message, occurred_at)
      values
        (${event.tenantId}, ${event.actorId}, ${event.category}, ${event.filename}, ${event.contentType}, ${event.sizeBytes}, ${event.reason}, ${event.message}, ${event.occurredAt})
    `);
  }
}
