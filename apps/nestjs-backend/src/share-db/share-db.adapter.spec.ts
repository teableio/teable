import type { EditOp } from 'sharedb';
import { describe, expect, it, vi } from 'vitest';
import { ShareDbAdapter } from './share-db.adapter';

const createAdapter = () => {
  const adapter = Object.create(ShareDbAdapter.prototype) as ShareDbAdapter;
  Object.assign(adapter, { logger: { log: vi.fn() } });
  return adapter;
};

const editOp = (subOps: unknown[]) => ({ op: subOps }) as unknown as EditOp;

const collection = 'rec_tblTest0000000001';

const filteredQuery = {
  ignoreViewQuery: true,
  filter: {
    conjunction: 'and',
    filterSet: [{ fieldId: 'fldFiltered00000001', operator: 'is', value: '1' }],
  },
};

describe('ShareDbAdapter skipPoll', () => {
  it('always polls for create and delete ops', () => {
    const adapter = createAdapter();
    expect(adapter.skipPoll(collection, 'rec1', { create: {} } as never, filteredQuery)).toBe(
      false
    );
    expect(adapter.skipPoll(collection, 'rec1', { del: true } as never, filteredQuery)).toBe(false);
  });

  it('polls when the view row order pseudo column changes', () => {
    const adapter = createAdapter();
    const op = editOp([{ p: ['fields', '__row_viwaTuM2nkzlPWclDH9'], oi: 3.375, od: 3 }]);
    expect(adapter.skipPoll(collection, 'rec1', op, filteredQuery)).toBe(false);
  });

  it('polls when an op mixes field values with pseudo columns', () => {
    const adapter = createAdapter();
    const op = editOp([
      { p: ['fields', 'fldUnrelated0000001'], oi: 'x' },
      { p: ['fields', '__row_viwaTuM2nkzlPWclDH9'], oi: 3.375, od: 3 },
    ]);
    expect(adapter.skipPoll(collection, 'rec1', op, filteredQuery)).toBe(false);
  });

  it('skips polling when modified fields do not affect the query', () => {
    const adapter = createAdapter();
    const op = editOp([{ p: ['fields', 'fldUnrelated0000001'], oi: 'x' }]);
    expect(adapter.skipPoll(collection, 'rec1', op, filteredQuery)).toBe(true);
  });

  it('polls when a modified field is referenced by the query filter', () => {
    const adapter = createAdapter();
    const op = editOp([{ p: ['fields', 'fldFiltered00000001'], oi: 'x' }]);
    expect(adapter.skipPoll(collection, 'rec1', op, filteredQuery)).toBe(false);
  });

  it('polls when a modified field is referenced by the record read filter', () => {
    const adapter = createAdapter();
    const op = editOp([{ p: ['fields', 'fldAuthority0000001'], oi: 'x' }]);
    const query = {
      ...filteredQuery,
      recordReadFilter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'fldAuthority0000001', operator: 'is', value: 'me' }],
      },
    };
    expect(adapter.skipPoll(collection, 'rec1', op, query)).toBe(false);
  });

  it('always polls for plain viewId queries whose view config lives server side', () => {
    const adapter = createAdapter();
    const op = editOp([{ p: ['fields', 'fldUnrelated0000001'], oi: 'x' }]);
    expect(adapter.skipPoll(collection, 'rec1', op, { viewId: 'viwaTuM2nkzlPWclDH9' })).toBe(false);
  });

  it('polls for a global filtering search (unbounded field scope)', () => {
    const adapter = createAdapter();
    const op = editOp([{ p: ['fields', 'fldUnrelated0000001'], oi: 'x' }]);
    const query = { ignoreViewQuery: true, search: ['hello', '', true] };
    expect(adapter.skipPoll(collection, 'rec1', op, query)).toBe(false);
  });
});
