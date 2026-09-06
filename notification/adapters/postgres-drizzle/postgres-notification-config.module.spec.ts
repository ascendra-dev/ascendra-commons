import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationModule } from '../../notification.module';
import { Notifier } from '../../notifier';
import { NOTIFIER } from '../../tokens';
import { PostgresNotificationConfigModule } from './postgres-notification-config.module';
import { POSTGRES_NOTIFICATION_CONFIG } from './tokens';

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
          model: 'database',
          configToken: POSTGRES_NOTIFICATION_CONFIG,
          imports: [PostgresNotificationConfigModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-pay', imports: [FakeDbModule] })],
        }),
      ],
    }).compile();

    const notifier = moduleRef.get<Notifier>(NOTIFIER);
    // No rows configured → the config resolves to zero channels → no_channel_configured.
    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'p@e.com' },
      notificationType: 'invoice.sent',
      variables: {},
      tenantId: 't1',
    });

    expect(result).toEqual({ status: 'failed', reason: 'no_channel_configured', channels: {} });
    await moduleRef.close();
  });

  it('a real end-to-end send when the fake db returns a route + template + credential', async () => {
    const execute = vi.fn(async (q: unknown) => {
      const { PgDialect } = await import('drizzle-orm/pg-core');
      const text = new PgDialect().sqlToQuery(q as never).sql;
      if (text.includes('notification_channel_route')) return { rows: [{ channels: ['email'] }] };
      if (text.includes('notification_template')) return { rows: [{ subject: 'Invoice', body: 'Hi', is_html: false }] };
      if (text.includes('notification_provider_credential')) return { rows: [{ config: { apiKey: 'k', from: 'b@e.com' } }] };
      return { rows: [] };
    });
    @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
    class FakeDbModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          model: 'database',
          configToken: POSTGRES_NOTIFICATION_CONFIG,
          imports: [
            PostgresNotificationConfigModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-pay', cacheTtlSeconds: 0, imports: [FakeDbModule] }),
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
