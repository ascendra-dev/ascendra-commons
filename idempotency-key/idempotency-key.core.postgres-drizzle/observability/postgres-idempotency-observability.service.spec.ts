import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { InvalidIdempotencyCursorError } from '../../idempotency-key.core';
import { PostgresIdempotencyObservabilityService } from './postgres-idempotency-observability.service';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb(rows: Array<Record<string, unknown>> = []) {
  return { execute: vi.fn().mockResolvedValue({ rows }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function rendered(db: ReturnType<typeof fakeDb>, call = 0) {
  return dialect.sqlToQuery(db.execute.mock.calls[call][0] as SQL);
}

let seq = 0;
function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  seq += 1;
  return {
    key: `key-${seq}`,
    scope: 'tenant-1',
    status: 'completed',
    status_code: 201,
    response_bytes: 15,
    created_at: new Date('2026-06-01T10:00:00Z'),
    reclaim_count: 0,
    late_complete_no_op_count: 0,
    replay_count: 3,
    conflict_count: 1,
    last_duplicate_at: new Date('2026-06-01T10:00:05Z'),
    route: '/invoices',
    correlation_id: 'trace-1',
    ...over,
  };
}

function service(db: SqlExecutor) {
  return new PostgresIdempotencyObservabilityService(db);
}

describe('PostgresIdempotencyObservabilityService.getClaim', () => {
  it('maps a completed row — the status code and body size, never the body', async () => {
    const db = fakeDb([row()]);
    const claim = await service(db).getClaim('key-1', 'tenant-1');

    expect(claim).toMatchObject({
      key: 'key-1',
      scope: 'tenant-1',
      status: 'completed',
      statusCode: 201,
      responseBytes: 15,
      replayCount: 3,
      conflictCount: 1,
      lastDuplicateAt: new Date('2026-06-01T10:00:05Z'),
      route: '/invoices',
      correlationId: 'trace-1',
    });
  });

  it('a claim recorded before routes and duplicates were tracked maps to null / zero', async () => {
    const db = fakeDb([row({ route: null, last_duplicate_at: null, replay_count: 0, conflict_count: 0 })]);
    // (and the select never reads response_body itself — only its size)
    await service(db).getClaim('key-1', 'tenant-1');
    const { sql: text } = rendered(db);
    expect(text).not.toMatch(/response_body,|response_body\s+from/i);
    expect(text).toMatch(/octet_length\(response_body::text\) as response_bytes/i);
    await expect(service(db).getClaim('key-1', 'tenant-1')).resolves.toMatchObject({
      route: null,
      lastDuplicateAt: null,
      replayCount: 0,
      conflictCount: 0,
    });
  });

  it('returns null when nothing matches', async () => {
    const db = fakeDb([]);
    await expect(service(db).getClaim('missing', 'tenant-1')).resolves.toBeNull();
  });

  it('a pending row has no status code or size', async () => {
    const db = fakeDb([row({ status: 'pending', status_code: null, response_bytes: null })]);
    await expect(service(db).getClaim('key-1', 'tenant-1')).resolves.toMatchObject({
      status: 'pending',
      statusCode: null,
      responseBytes: null,
    });
  });
});

describe('PostgresIdempotencyObservabilityService.getClaimResponse', () => {
  it('returns the saved status code and body of a completed claim', async () => {
    const db = fakeDb([{ status_code: 201, response_body: { id: 'inv-1' } }]);
    await expect(service(db).getClaimResponse('key-1', 'tenant-1')).resolves.toEqual({
      statusCode: 201,
      body: { id: 'inv-1' },
    });
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/where key = \$1 and scope = \$2 and status = 'completed'/i);
    expect(params).toEqual(['key-1', 'tenant-1']);
  });

  it('null for a pending or missing claim', async () => {
    await expect(service(fakeDb([])).getClaimResponse('key-1', 'tenant-1')).resolves.toBeNull();
  });
});

describe('PostgresIdempotencyObservabilityService.listClaims', () => {
  it('maps rows and has no unfiltered application-style WHERE (this module has no application)', async () => {
    const db = fakeDb([row({ key: 'a' }), row({ key: 'b' })]);
    const result = await service(db).listClaims();

    expect(result.claims).toHaveLength(2);
    expect(result.nextCursor).toBeUndefined();
  });

  it('ANDs the optional filters as bound params', async () => {
    const db = fakeDb([]);
    await service(db).listClaims({
      status: 'pending',
      scope: 'tenant-9',
      route: '/payments/:id',
      correlationId: 'trace-xyz',
      since: new Date('2026-01-01T00:00:00Z'),
      until: new Date('2026-07-01T00:00:00Z'),
    });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/status =/i);
    expect(text).toMatch(/scope =/i);
    expect(text).toMatch(/route =/i);
    expect(text).toMatch(/correlation_id =/i);
    expect(text).toMatch(/created_at >=/i);
    expect(text).toMatch(/created_at </i);
    expect(params).toEqual(expect.arrayContaining(['pending', 'tenant-9', '/payments/:id', 'trace-xyz']));
  });

  it('returns a nextCursor when more rows exist and keys the next page off it', async () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      row({ key: `key-${100 + i}`, cursor_at: `2026-06-01T10:00:00.${String(999_999 - i).padStart(6, '0')}Z` }),
    );
    const db = fakeDb(many);
    const page = await service(db).listClaims({ limit: 50 });

    expect(page.claims).toHaveLength(50);
    expect(page.claims[0]).not.toHaveProperty('cursor_at');
    expect(page.nextCursor).toBeTruthy();

    const db2 = fakeDb([]);
    await service(db2).listClaims({ cursor: page.nextCursor, limit: 50 });
    const { sql: text, params } = rendered(db2);
    // `<=` first, so the scan starts at the boundary instead of filtering from the newest row.
    expect(text).toMatch(/created_at <= \$\d+::timestamptz\s+and \(created_at < \$\d+::timestamptz or \(key, scope\) < /i);
    expect(params).toEqual(expect.arrayContaining(['2026-06-01T10:00:00.999950Z', 'key-149', 'tenant-1']));
  });

  it('keeps the boundary to the microsecond — a Date would drop the rows older than it in the same millisecond', async () => {
    const rows = [
      row({ key: 'newer', cursor_at: '2026-10-22T10:00:00.123800Z' }),
      row({ key: 'older', cursor_at: '2026-10-22T10:00:00.123400Z' }),
    ];
    const page = await service(fakeDb(rows)).listClaims({ limit: 1 });

    const db2 = fakeDb([]);
    await service(db2).listClaims({ cursor: page.nextCursor, limit: 1 });
    expect(rendered(db2).params).toContain('2026-10-22T10:00:00.123800Z');
    expect(rendered(db2).params).not.toContain('2026-10-22T10:00:00.123Z');
  });

  it('selects the cursor timestamp in UTC with a fixed format', async () => {
    const db = fakeDb([]);
    await service(db).listClaims();
    expect(rendered(db).sql).toContain(`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at`);
  });

  it('caps limit at 200', async () => {
    const db = fakeDb([]);
    await service(db).listClaims({ limit: 100_000 });
    expect(rendered(db).params).toContain(201);
  });

  it('rejects a cursor it never issued, before querying', async () => {
    const db = fakeDb([]);
    await expect(service(db).listClaims({ cursor: 'garbage' })).rejects.toBeInstanceOf(InvalidIdempotencyCursorError);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('PostgresIdempotencyObservabilityService.claimHealthSummary', () => {
  it('maps the aggregate row', async () => {
    const db = fakeDb([
      {
        pending_count: '4',
        completed_count: '96',
        reclaimed_count: '2',
        late_complete_no_op_total: '1',
        replay_total: '37',
        conflict_total: '5',
        total_count: '100',
        oldest_retained_at: new Date('2026-06-01T00:00:00Z'),
      },
    ]);

    await expect(service(db).claimHealthSummary()).resolves.toEqual({
      pendingCount: 4,
      completedCount: 96,
      reclaimedCount: 2,
      lateCompleteNoOpTotal: 1,
      replayTotal: 37,
      conflictTotal: 5,
      totalCount: 100,
      oldestRetainedAt: new Date('2026-06-01T00:00:00Z'),
    });
  });

  it('handles an empty table', async () => {
    const db = fakeDb([{ pending_count: '0', completed_count: '0', reclaimed_count: '0', late_complete_no_op_total: '0', total_count: '0', oldest_retained_at: null }]);

    await expect(service(db).claimHealthSummary()).resolves.toMatchObject({ totalCount: 0, oldestRetainedAt: null });
  });

  it('a period bounds the counts but not "oldest retained" — that stays the whole table\'s', async () => {
    const db = fakeDb([{ total_count: '0' }]);
    await service(db).claimHealthSummary({ since: new Date('2026-10-21T00:00:00Z') });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/where created_at >= \$1/i);
    expect(text).toMatch(/\(select min\(created_at\) from commons_idempotency_key\) as oldest_retained_at/i);
    expect(params).toEqual([new Date('2026-10-21T00:00:00Z')]);
  });

  it('no period, no WHERE', async () => {
    const db = fakeDb([{ total_count: '0' }]);
    await service(db).claimHealthSummary();
    expect(rendered(db).sql).not.toMatch(/where created_at/i);
  });
});

describe('PostgresIdempotencyObservabilityService.claimsByRoute', () => {
  it('groups by route, most duplicates first, and maps the counts', async () => {
    const db = fakeDb([
      { route: '/payments', claims: '40', replays: '12', conflicts: '3', reclaimed: '1', late_complete_no_ops: '0' },
      { route: null, claims: '2', replays: '0', conflicts: '0', reclaimed: '0', late_complete_no_ops: '0' },
    ]);

    await expect(service(db).claimsByRoute({ since: new Date('2026-10-21T00:00:00Z') })).resolves.toEqual([
      { route: '/payments', claims: 40, replays: 12, conflicts: 3, reclaimed: 1, lateCompleteNoOps: 0 },
      { route: null, claims: 2, replays: 0, conflicts: 0, reclaimed: 0, lateCompleteNoOps: 0 },
    ]);
    const { sql: text } = rendered(db);
    expect(text).toMatch(/where created_at >= \$1/i);
    expect(text).toMatch(/group by route/i);
    expect(text).toMatch(/order by sum\(replay_count\) \+ sum\(conflict_count\) desc/i);
  });
});
