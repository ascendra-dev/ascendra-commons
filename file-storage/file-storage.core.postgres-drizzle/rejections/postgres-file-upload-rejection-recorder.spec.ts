import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresFileUploadRejectionRecorder } from './postgres-file-upload-rejection-recorder';
import type { SqlExecutor } from '../persistence/sql-executor';
import type { FileUploadRejectionEvent } from '../../file-storage.core';

const dialect = new PgDialect();

const event: FileUploadRejectionEvent = {
  tenantId: 't1',
  actorId: 'u1',
  category: 'kyc.identity-document',
  filename: 'passport.heic',
  contentType: 'image/heic',
  sizeBytes: 1234,
  reason: 'validation-failed',
  message: 'content type image/heic not accepted',
  occurredAt: new Date('2026-09-07T10:22:00Z'),
};

describe('PostgresFileUploadRejectionRecorder', () => {
  it('inserts one commons_file_rejection row with the event fields', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const recorder = new PostgresFileUploadRejectionRecorder({ execute } as SqlExecutor);

    await recorder.record(event);

    expect(execute).toHaveBeenCalledTimes(1);
    const q = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(q.sql).toMatch(/insert into commons_file_rejection/i);
    expect(q.params).toEqual(
      expect.arrayContaining([
        't1',
        'u1',
        'kyc.identity-document',
        'passport.heic',
        'image/heic',
        1234,
        'validation-failed',
        'content type image/heic not accepted',
      ]),
    );
  });

  it('propagates a genuine DB error to the caller (the caller does the catch-and-ignore)', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('db down'));
    const recorder = new PostgresFileUploadRejectionRecorder({ execute } as SqlExecutor);
    await expect(recorder.record(event)).rejects.toThrow('db down');
  });
});
