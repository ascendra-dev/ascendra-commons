import { describe, expect, it } from 'vitest';
import { StaticNotificationConfig } from './notification-config';
import type { NotificationChannel } from './notification.types';

describe('StaticNotificationConfig', () => {
  const config = new StaticNotificationConfig({
    channels: {
      'invoice.sent': ['email'],
      'payment.overdue.reminder': ['email', 'sms'],
    },
    templates: {
      email: { 'invoice.sent': { subject: 'Invoice ready', body: 'Hi' } },
      sms: { 'payment.overdue.reminder': { body: 'Pay {{amount}}' } },
    },
    providerConfigs: {
      email: { 't1': { apiKey: 'e-key', from: 'billing@example.com' } },
      sms: { 't1': { apiKey: 's-key', from: '+10000000000' } },
    },
  });

  describe('channelsFor', () => {
    it('returns the configured channels', async () => {
      await expect(config.channelsFor('payment.overdue.reminder', null)).resolves.toEqual(['email', 'sms']);
    });

    it('fails closed with an empty array for an unconfigured notificationType', async () => {
      await expect(config.channelsFor('unknown.type', null)).resolves.toEqual([]);
    });

    it('ignores tenantId — one routing config for the whole deployment', async () => {
      await expect(config.channelsFor('invoice.sent', 't1')).resolves.toEqual(['email']);
      await expect(config.channelsFor('invoice.sent', 't2')).resolves.toEqual(['email']);
    });
  });

  describe('templateFor', () => {
    it('returns the template for a channel + notificationType', async () => {
      await expect(config.templateFor('email', 'invoice.sent', null)).resolves.toEqual({
        subject: 'Invoice ready',
        body: 'Hi',
      });
    });

    it('returns null when the channel has no template for that type', async () => {
      await expect(config.templateFor('email', 'payment.overdue.reminder', null)).resolves.toBeNull();
    });

    it('returns null when the channel has no templates at all', async () => {
      await expect(config.templateFor('whatsapp', 'invoice.sent', null)).resolves.toBeNull();
    });

    it('ignores tenantId — one template per channel for the whole deployment', async () => {
      await expect(config.templateFor('email', 'invoice.sent', 't9')).resolves.toEqual({
        subject: 'Invoice ready',
        body: 'Hi',
      });
    });
  });

  describe('providerConfigFor', () => {
    it('resolves credentials by channel + tenantId', async () => {
      await expect(config.providerConfigFor('sms', 't1')).resolves.toEqual({ apiKey: 's-key', from: '+10000000000' });
    });

    it('fails closed for a tenant with no registered credentials', async () => {
      await expect(config.providerConfigFor('email', 'unknown-tenant')).resolves.toBeNull();
    });

    it('fails closed for a null tenantId — no deployment-wide default to fall back to', async () => {
      await expect(config.providerConfigFor('email', null)).resolves.toBeNull();
    });

    it('fails closed for a channel with no credentials configured', async () => {
      await expect(config.providerConfigFor('whatsapp', 't1')).resolves.toBeNull();
    });
  });

  it('a subclass can override one method and keep the others static', async () => {
    class DbRouting extends StaticNotificationConfig {
      async channelsFor(_type: string, _tenantId: string | null): Promise<NotificationChannel[]> {
        return ['whatsapp'];
      }
    }
    const c = new DbRouting({ channels: {}, templates: { email: { x: { body: 'static' } } } });

    await expect(c.channelsFor('anything', null)).resolves.toEqual(['whatsapp']);
    await expect(c.templateFor('email', 'x', null)).resolves.toEqual({ body: 'static' });
  });
});
