import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationModule, Notifier, NOTIFIER } from '../../notification.core';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PostgresNotificationConfigModule } from './postgres-notification-config.module';
import { POSTGRES_NOTIFICATION_CONFIG } from '../tokens';

const DB = Symbol('DB');

describe('PostgresNotificationConfigModule wired into NotificationModule', () => {
  it('binds NOTIFICATION_CONFIG to the Postgres implementation via configToken', async () => {
    @Module({
      providers: [{ provide: DB, useValue: { execute: vi.fn().mockResolvedValue({ rows: [] }) } }],
      exports: [DB],
    })
    class FakeDbModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          configToken: POSTGRES_NOTIFICATION_CONFIG,
          imports: [
            PostgresNotificationConfigModule.forRoot({
              sqlExecutorToken: DB,
              application: 'ascendra-pay',
              imports: [FakeDbModule],
            }),
          ],
        }),
      ],
    }).compile();

    const result = await moduleRef.get<Notifier>(NOTIFIER).notify({
      recipient: { type: 'raw', email: 'p@e.com' },
      notificationType: 'invoice.sent',
      variables: {},
      tenantId: 't1',
    });
    expect(result).toEqual({ status: 'failed', reason: 'no_channel_configured', channels: {} });
    await moduleRef.close();
  });

  it('a real end-to-end send when the fake db returns a route + template + credential', async () => {
    const dialect = new PgDialect();
    const execute = vi.fn(async (q: never) => {
      const text = dialect.sqlToQuery(q).sql;
      if (text.includes('commons_notification_channel_route')) return { rows: [{ channels: ['email'] }] };
      if (text.includes('commons_notification_template')) return { rows: [{ subject: 'Invoice', body: 'Hi', is_html: false }] };
      if (text.includes('commons_notification_provider_credential')) return { rows: [{ config: { apiKey: 'k', from: 'b@e.com' } }] };
      return { rows: [] };
    });
    @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
    class FakeDbModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          configToken: POSTGRES_NOTIFICATION_CONFIG,
          imports: [
            PostgresNotificationConfigModule.forRoot({
              sqlExecutorToken: DB,
              application: 'ascendra-pay',
              cacheTtlSeconds: 0,
              imports: [FakeDbModule],
            }),
          ],
        }),
      ],
    }).compile();

    const result = await moduleRef.get<Notifier>(NOTIFIER).notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: {},
      tenantId: 't1',
    });
    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
    await moduleRef.close();
  });
});
