import { describe, expect, it } from 'vitest';
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { getCurrentCorrelationId } from './correlation-context';

describe('CorrelationIdMiddleware', () => {
  it('reuses an inbound x-correlation-id header', () => {
    const middleware = new CorrelationIdMiddleware();
    let seen: string | undefined;

    middleware.use({ headers: { 'x-correlation-id': 'from-upstream' } }, {}, () => {
      seen = getCurrentCorrelationId();
    });

    expect(seen).toBe('from-upstream');
  });

  it('generates a fresh id when no header is present', () => {
    const middleware = new CorrelationIdMiddleware();
    let seen: string | undefined;

    middleware.use({ headers: {} }, {}, () => {
      seen = getCurrentCorrelationId();
    });

    expect(seen).toBeTruthy();
  });

  it('ignores a non-string header value (e.g. a duplicated header parsed as an array) and generates a fresh id instead', () => {
    const middleware = new CorrelationIdMiddleware();
    let seen: string | undefined;

    middleware.use({ headers: { 'x-correlation-id': ['a', 'b'] } }, {}, () => {
      seen = getCurrentCorrelationId();
    });

    expect(seen).toBeTruthy();
    expect(seen).not.toEqual(['a', 'b']);
  });

  it('replaces a malformed header — overlong, whitespace, control characters, markup — with a fresh id', () => {
    const middleware = new CorrelationIdMiddleware();
    for (const bad of ['x'.repeat(129), 'two words', 'a\r\nX-Injected: 1', '<script>', '']) {
      let seen: string | undefined;
      middleware.use({ headers: { 'x-correlation-id': bad } }, {}, () => {
        seen = getCurrentCorrelationId();
      });
      expect(seen).not.toBe(bad);
      expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('keeps the usual tracing formats — a UUID, a W3C trace id, a dotted service id', () => {
    const middleware = new CorrelationIdMiddleware();
    for (const good of ['5b9e1c04-2a71-4c3e-9f8a-d3b6e0c1a1a1', '4bf92f3577b34da6a3ce929d0e0e4736', 'pay-api:job.42', 'x'.repeat(128)]) {
      let seen: string | undefined;
      middleware.use({ headers: { 'x-correlation-id': good } }, {}, () => {
        seen = getCurrentCorrelationId();
      });
      expect(seen).toBe(good);
    }
  });

  it('the same id is visible for the whole handler, not just the entry point', () => {
    const middleware = new CorrelationIdMiddleware();
    const seen: string[] = [];

    middleware.use({ headers: { 'x-correlation-id': 'stable-id' } }, {}, () => {
      seen.push(getCurrentCorrelationId());
      seen.push(getCurrentCorrelationId());
    });

    expect(seen).toEqual(['stable-id', 'stable-id']);
  });
});
