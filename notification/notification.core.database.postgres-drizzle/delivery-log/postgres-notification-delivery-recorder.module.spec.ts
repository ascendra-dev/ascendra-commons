import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { NotificationModule, Notifier, NOTIFIER } from '../../notification.core';
import { StaticNotificationConfigModule, STATIC_NOTIFICATION_CONFIG } from '../../notification.core.static';
import { PostgresNotificationDeliveryRecorderModule } from './postgres-notification-delivery-recorder.module';
import { POSTGRES_NOTIFICATION_DELIVERY_RECORDER } from '../tokens';

const DB = Symbol('DB');
const dialect = new PgDialect();

describe('PostgresNotificationDeliveryRecorderModule wired into NotificationModule', () => {
  it('Notifier writes a delivery row per channel through the recorder', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
    class DbModule {}

    const ref = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          configToken: STATIC_NOTIFICATION_CONFIG,
          deliveryRecorderToken: POSTGRES_NOTIFICATION_DELIVERY_RECORDER,
          imports: [
            StaticNotificationConfigModule.forRoot({ channels: { 'invoice.sent': ['email'] } }),
            PostgresNotificationDeliveryRecorderModule.forRoot({
              sqlExecutorToken: DB,
              application: 'ascendra-pay',
              imports: [DbModule],
            }),
          ],
        }),
      ],
    }).compile();

    await ref.get<Notifier>(NOTIFIER).notify({
      recipient: { type: 'user', id: 'u1' },
      notificationType: 'invoice.sent',
      variables: {},
    });
    // The recorder buffers; closing the app writes what's waiting (as app.enableShutdownHooks() does).
    expect(execute).not.toHaveBeenCalled();
    await ref.close();

    const insert = execute.mock.calls.find((c) =>
      /insert into commons_notification_delivery/i.test(dialect.sqlToQuery(c[0] as SQL).sql),
    );
    expect(insert).toBeDefined();
    expect(dialect.sqlToQuery(insert![0] as SQL).params).toEqual(
      expect.arrayContaining(['ascendra-pay', 'invoice.sent', 'email', 'user:u1']),
    );
  });
});
