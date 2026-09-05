import { describe, expect, it } from 'vitest';
import { StaticProviderConfigResolver } from './notification-provider-config';

describe('StaticProviderConfigResolver', () => {
  it('resolves the config registered for a tenantId', async () => {
    const resolver = new StaticProviderConfigResolver({
      't1': { apiKey: 'key-1', fromAddress: 'a@example.com' },
    });

    await expect(resolver.configFor('t1')).resolves.toEqual({ apiKey: 'key-1', fromAddress: 'a@example.com' });
  });

  it('fails closed for a tenantId with no registered config', async () => {
    const resolver = new StaticProviderConfigResolver({ t1: { apiKey: 'key-1', fromAddress: 'a@example.com' } });

    await expect(resolver.configFor('unknown-tenant')).resolves.toBeNull();
  });

  it('fails closed for a null tenantId — there is no deployment-wide default to fall back to', async () => {
    const resolver = new StaticProviderConfigResolver({ t1: { apiKey: 'key-1', fromAddress: 'a@example.com' } });

    await expect(resolver.configFor(null)).resolves.toBeNull();
  });
});
