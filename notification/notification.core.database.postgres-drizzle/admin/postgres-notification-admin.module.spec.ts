import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  NOTIFICATION_CONFIG_ADMIN_PORT,
  NOTIFICATION_OBSERVABILITY_PORT,
  type NotificationConfigAdminPort,
  type NotificationObservabilityPort,
} from '../../notification.core.database';
import { PostgresNotificationAdminModule } from './postgres-notification-admin.module';
import { PostgresNotificationConfigAdminService } from './postgres-notification-config-admin.service';
import { PostgresNotificationObservabilityService } from './postgres-notification-observability.service';

const DB = Symbol('DB');
const dialect = new PgDialect();

describe('PostgresNotificationAdminModule', () => {
  it('binds both family port tokens to the Postgres services, wired to the db token + application', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
    class DbModule {}

    const ref = await Test.createTestingModule({
      imports: [PostgresNotificationAdminModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] })],
    }).compile();

    const observability = ref.get<NotificationObservabilityPort>(NOTIFICATION_OBSERVABILITY_PORT);
    const configAdmin = ref.get<NotificationConfigAdminPort>(NOTIFICATION_CONFIG_ADMIN_PORT);
    expect(observability).toBeInstanceOf(PostgresNotificationObservabilityService);
    expect(configAdmin).toBeInstanceOf(PostgresNotificationConfigAdminService);

    await configAdmin.setChannelRoute({ notificationType: 'x', tenantId: null, channels: ['email'] });
    expect(dialect.sqlToQuery(execute.mock.calls[0][0] as SQL).params).toContain('ascendra-erp');
    await ref.close();
  });
});
