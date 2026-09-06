import { describe, expect, it, vi } from 'vitest';
import { ScheduledJob } from './scheduled-job.port';
import { ScheduledJobRegistry } from './scheduled-job-registry';

function job(name: string): ScheduledJob<unknown> {
  return { name, findDueItems: vi.fn().mockResolvedValue([]), processItem: vi.fn() };
}

describe('ScheduledJobRegistry', () => {
  it('resolves a registered job by name', () => {
    const a = job('invoice-reminder');
    const registry = new ScheduledJobRegistry([a, job('job-run-pruner')]);

    expect(registry.get('invoice-reminder')).toBe(a);
    expect(registry.get('nope')).toBeUndefined();
  });

  it('names() lists every registered job', () => {
    const registry = new ScheduledJobRegistry([job('a'), job('b')]);
    expect(registry.names().sort()).toEqual(['a', 'b']);
  });

  it('is empty when constructed with no jobs', () => {
    const registry = new ScheduledJobRegistry([]);
    expect(registry.names()).toEqual([]);
  });

  it('throws at construction if two jobs share a name — a name is also the advisory lock key', () => {
    expect(() => new ScheduledJobRegistry([job('dup'), job('dup')])).toThrow(/name "dup"/);
  });
});
