import { describe, expect, it } from 'vitest';
import { diffFields } from './field-diff';

describe('diffFields', () => {
  it('reports only the keys whose value actually changed', () => {
    expect(diffFields({ status: 'awaiting_payment', paidAt: null, amount: 4820 }, { status: 'paid', paidAt: '2026-09-07T09:41:02Z', amount: 4820 })).toEqual([
      { field: 'paidAt', before: null, after: '2026-09-07T09:41:02Z' },
      { field: 'status', before: 'awaiting_payment', after: 'paid' },
    ]);
  });

  it('treats null before/after as an empty object', () => {
    expect(diffFields(null, { status: 'created' })).toEqual([{ field: 'status', before: null, after: 'created' }]);
    expect(diffFields({ status: 'deleted' }, null)).toEqual([{ field: 'status', before: 'deleted', after: null }]);
    expect(diffFields(null, null)).toEqual([]);
  });

  it('treats a key present on only one side as null on the other', () => {
    expect(diffFields({ a: 1 }, { a: 1, b: 2 })).toEqual([{ field: 'b', before: null, after: 2 }]);
  });

  it('returns an empty array when nothing changed', () => {
    expect(diffFields({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
  });

  it('deep-compares nested object/array values instead of reference-comparing them', () => {
    expect(diffFields({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual([]);
    expect(diffFields({ tags: ['a', 'b'] }, { tags: ['a', 'c'] })).toEqual([{ field: 'tags', before: ['a', 'b'], after: ['a', 'c'] }]);
  });

  it('sorts diff entries by field name', () => {
    expect(diffFields({ z: 1, a: 1 }, { z: 2, a: 2 })).toEqual([
      { field: 'a', before: 1, after: 2 },
      { field: 'z', before: 1, after: 2 },
    ]);
  });
});
