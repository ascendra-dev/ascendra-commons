import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationModule, NOTIFIER, Notifier } from '../../index';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresNotificationAdminModule } from './postgres-notification-admin.module';
import { PostgresNotificationDeliveryRecorderModule } from './postgres-notification-delivery-recorder.module';
import { PostgresNotificationConfigAdminService } from './notification-config-admin.service';
import { PostgresNotificationObservabilityService } from './notification-observability.service';
import {
  POSTGRES_NOTIFICATION_CONFIG_ADMIN,
  POSTGRES_NOTIFICATION_DELIVERY_RECORDER,
  POSTGRES_NOTIFICATION_OBSERVABILITY,
} from './admin-tokens';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresNotificationAdminModule', () => {
  it('resolves the observability and config-admin services wired to the db token + application', async () => {
    const { DbModule, execute } = dbModule();
    const ref = await Test.createTestingModule({
      imports: [PostgresNotificationAdminModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] })],
    }).compile();

    expect(ref.get(POSTGRES_NOTIFICATION_OBSERVABILITY)).toBeInstanceOf(PostgresNotificationObservabilityService);
    expect(ref.get(POSTGRES_NOTIFICATION_CONFIG_ADMIN)).toBeInstanceOf(PostgresNotificationConfigAdminService);

    await ref.get<PostgresNotificationConfigAdminService>(POSTGRES_NOTIFICATION_CONFIG_ADMIN)
      .setChannelRoute({ notificationType: 'x', tenantId: null, channels: ['email'] });
    expect(dialect.sqlToQuery(execute.mock.calls[0][0] as SQL).params).toContain('ascendra-erp');
  });
});

describe('PostgresNotificationDeliveryRecorderModule wired into NotificationModule', () => {
  it('Notifier writes a delivery row per channel through the recorder', async () => {
    const { DbModule, execute } = dbModule();
    const ref = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          model: 'static',
          channels: { 'invoice.sent': ['email'] },
          deliveryRecorderToken: POSTGRES_NOTIFICATION_DELIVERY_RECORDER,
          imports: [
            DbModule,
            PostgresNotificationDeliveryRecorderModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-pay', imports: [DbModule] }),
          ],
        }),
      ],
    }).compile();

    const notifier = ref.get<Notifier>(NOTIFIER);
    await notifier.notify({ recipient: { type: 'user', id: 'u1' }, notificationType: 'invoice.sent', variables: {} });

    const insert = execute.mock.calls.find((c) => /insert into commons_notification_delivery/i.test(dialect.sqlToQuery(c[0] as SQL).sql));
    expect(insert).toBeDefined();
    expect(dialect.sqlToQuery(insert![0] as SQL).params).toEqual(expect.arrayContaining(['ascendra-pay', 'invoice.sent', 'email', 'user:u1']));
  });
});
