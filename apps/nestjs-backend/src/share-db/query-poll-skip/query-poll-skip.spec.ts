import type { EditOp } from 'sharedb';
import { describe, expect, it } from 'vitest';
import { shouldSkipQueryPoll } from '.';

const editOp = (subOps: unknown[]) => ({ op: subOps }) as unknown as EditOp;

const collection = 'rec_tblTest0000000001';

const filteredQuery = {
  ignoreViewQuery: true,
  filter: {
    conjunction: 'and',
    filterSet: [{ fieldId: 'fldFiltered00000001', operator: 'is', value: '1' }],
  },
};

describe('shouldSkipQueryPoll', () => {
  it('always polls for create and delete ops', () => {
    expect(shouldSkipQueryPoll(collection, 'rec1', { create: {} } as never, filteredQuery)).toBe(
      false
    );
    expect(shouldSkipQueryPoll(collection, 'rec1', { del: true } as never, filteredQuery)).toBe(
      false
    );
  });

  it('always polls for subscription types without a strategy', () => {
    const op = editOp([{ p: ['options'], oi: 'x' }]);
    expect(shouldSkipQueryPoll('fld_tblTest0000000001', 'fld1', op, {})).toBe(false);
  });

  describe('table and view doc list subscriptions', () => {
    const viewCollection = 'viw_tblTest0000000001';
    const tableCollection = 'tbl_bseTest0000000001';

    it('polls when a view or table changes its order', () => {
      const op = editOp([{ p: ['order'], oi: 2, od: 1 }]);
      expect(shouldSkipQueryPoll(viewCollection, 'viw1', op, {})).toBe(false);
      expect(shouldSkipQueryPoll(tableCollection, 'tbl1', op, {})).toBe(false);
      // order mixed into a larger op still polls
      const mixed = editOp([
        { p: ['name'], oi: 'b', od: 'a' },
        { p: ['order'], oi: 2, od: 1 },
      ]);
      expect(shouldSkipQueryPoll(viewCollection, 'viw1', mixed, {})).toBe(false);
    });

    it('skips view edits that cannot change the view id list', () => {
      for (const p of [
        ['filter'],
        ['sort'],
        ['options'],
        ['columnMeta', 'fldTest00000000001'],
        ['isLocked'],
        ['name'],
        ['shareMeta'],
        ['lastModifiedTime'],
      ]) {
        const op = editOp([{ p, oi: 'x', od: 'y' }]);
        expect(shouldSkipQueryPoll(viewCollection, 'viw1', op, {})).toBe(true);
      }
    });

    it('skips table doc edits, including the nested views mirror', () => {
      const viewMirror = editOp([
        { p: ['views', 0, 'filter'], oi: {}, od: null },
        { p: ['views', 0, 'lastModifiedTime'], oi: 't2', od: 't1' },
      ]);
      expect(shouldSkipQueryPoll(tableCollection, 'tbl1', viewMirror, {})).toBe(true);
      // view create/delete rewrites the whole views array on the table doc
      const viewsReplaced = editOp([{ p: ['views'], oi: [], od: [] }]);
      expect(shouldSkipQueryPoll(tableCollection, 'tbl1', viewsReplaced, {})).toBe(true);
      const rename = editOp([{ p: ['name'], oi: 'b', od: 'a' }]);
      expect(shouldSkipQueryPoll(tableCollection, 'tbl1', rename, {})).toBe(true);
    });

    it('polls when a sub op has no analyzable path', () => {
      const op = editOp([{ oi: 'x' }]);
      expect(shouldSkipQueryPoll(viewCollection, 'viw1', op, {})).toBe(false);
    });
  });

  it('polls row order changes only for subscriptions on the same view', () => {
    const op = editOp([{ p: ['fields', '__row_viwaTuM2nkzlPWclDH9'], oi: 3.375, od: 3 }]);
    // same view rides the manual order, inlined or not
    expect(shouldSkipQueryPoll(collection, 'rec1', op, { viewId: 'viwaTuM2nkzlPWclDH9' })).toBe(
      false
    );
    expect(
      shouldSkipQueryPoll(collection, 'rec1', op, {
        ...filteredQuery,
        viewId: 'viwaTuM2nkzlPWclDH9',
      })
    ).toBe(false);
    // other views and view-less queries never read this pseudo column
    expect(shouldSkipQueryPoll(collection, 'rec1', op, { viewId: 'viwOther00000000001' })).toBe(
      true
    );
    expect(shouldSkipQueryPoll(collection, 'rec1', op, filteredQuery)).toBe(true);
  });

  it('falls back to field analysis when an op mixes field values with row order columns', () => {
    const op = editOp([
      { p: ['fields', 'fldUnrelated0000001'], oi: 'x' },
      { p: ['fields', '__row_viwaTuM2nkzlPWclDH9'], oi: 3.375, od: 3 },
    ]);
    expect(shouldSkipQueryPoll(collection, 'rec1', op, filteredQuery)).toBe(true);
    const filteredOp = editOp([
      { p: ['fields', 'fldFiltered00000001'], oi: 'x' },
      { p: ['fields', '__row_viwaTuM2nkzlPWclDH9'], oi: 3.375, od: 3 },
    ]);
    expect(shouldSkipQueryPoll(collection, 'rec1', filteredOp, filteredQuery)).toBe(false);
  });

  it('polls when an op touches an unknown pseudo column', () => {
    const op = editOp([{ p: ['fields', '__unknown_column'], oi: 'x' }]);
    expect(shouldSkipQueryPoll(collection, 'rec1', op, filteredQuery)).toBe(false);
  });

  it('skips polling when modified fields do not affect the query', () => {
    const op = editOp([{ p: ['fields', 'fldUnrelated0000001'], oi: 'x' }]);
    expect(shouldSkipQueryPoll(collection, 'rec1', op, filteredQuery)).toBe(true);
  });

  it('polls when a modified field is referenced by the query filter', () => {
    const op = editOp([{ p: ['fields', 'fldFiltered00000001'], oi: 'x' }]);
    expect(shouldSkipQueryPoll(collection, 'rec1', op, filteredQuery)).toBe(false);
  });

  it('polls when a modified field is referenced by the record read filter', () => {
    const op = editOp([{ p: ['fields', 'fldAuthority0000001'], oi: 'x' }]);
    const query = {
      ...filteredQuery,
      recordReadFilter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'fldAuthority0000001', operator: 'is', value: 'me' }],
      },
    };
    expect(shouldSkipQueryPoll(collection, 'rec1', op, query)).toBe(false);
  });

  it('always polls for plain viewId queries whose view config lives server side', () => {
    const op = editOp([{ p: ['fields', 'fldUnrelated0000001'], oi: 'x' }]);
    expect(shouldSkipQueryPoll(collection, 'rec1', op, { viewId: 'viwaTuM2nkzlPWclDH9' })).toBe(
      false
    );
  });

  it('polls for a global filtering search (unbounded field scope)', () => {
    const op = editOp([{ p: ['fields', 'fldUnrelated0000001'], oi: 'x' }]);
    const query = { ignoreViewQuery: true, search: ['hello', '', true] };
    expect(shouldSkipQueryPoll(collection, 'rec1', op, query)).toBe(false);
  });

  describe('forwarded field options ops', () => {
    const fieldId = 'fldSelect0000000001';
    const fieldOp = editOp([{ p: ['options'], oi: { choices: [] }, od: { choices: [] } }]);

    it('polls plain viewId subscriptions whose conditions live server side', () => {
      expect(
        shouldSkipQueryPoll(collection, fieldId, fieldOp, { viewId: 'viwaTuM2nkzlPWclDH9' })
      ).toBe(false);
    });

    it('polls inlined subscriptions referencing the field', () => {
      const query = { ignoreViewQuery: true, orderBy: [{ fieldId, order: 'asc' }] };
      expect(shouldSkipQueryPoll(collection, fieldId, fieldOp, query)).toBe(false);
    });

    it('skips inlined subscriptions not referencing the field', () => {
      expect(shouldSkipQueryPoll(collection, fieldId, fieldOp, filteredQuery)).toBe(true);
    });

    it('polls for a global filtering search (unbounded field scope)', () => {
      const query = { ignoreViewQuery: true, search: ['hello', '', true] };
      expect(shouldSkipQueryPoll(collection, fieldId, fieldOp, query)).toBe(false);
    });
  });
});
