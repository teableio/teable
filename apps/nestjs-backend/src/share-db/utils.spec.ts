import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import { describe, expect, it } from 'vitest';
import { stripInstructionlessComponents } from './utils';

describe('stripInstructionlessComponents', () => {
  it('removes a component that carries no json0 instruction', () => {
    const op: EditOp = {
      c: 'viw_tblTest',
      d: 'viwTest',
      v: 3,
      src: 'server',
      seq: 1,
      m: {},
      create: undefined,
      del: undefined,
      op: [{ p: ['name'], oi: 'Renamed' }, { p: ['filter'] }],
    };

    expect(stripInstructionlessComponents(op)).toEqual({
      ...op,
      op: [{ p: ['name'], oi: 'Renamed' }],
    });
  });

  it('drops an op whose components are all instruction-less', () => {
    const op: EditOp = {
      c: 'viw_tblTest',
      d: 'viwTest',
      v: 3,
      src: 'server',
      seq: 1,
      m: {},
      create: undefined,
      del: undefined,
      op: [{ p: ['filter'] }],
    };

    expect(stripInstructionlessComponents(op)).toBeUndefined();
  });

  it('keeps explicit nulls, which are instructions', () => {
    const op: EditOp = {
      c: 'viw_tblTest',
      d: 'viwTest',
      v: 3,
      src: 'server',
      seq: 1,
      m: {},
      create: undefined,
      del: undefined,
      op: [{ p: ['filter'], od: null, oi: null }],
    };

    expect(stripInstructionlessComponents(op)).toEqual(op);
  });

  it('passes through ops without a component list and ops that are fully applicable', () => {
    const editOp: EditOp = {
      c: 'tbl_bseTest',
      d: 'tblTest',
      v: 2,
      src: 'server',
      seq: 1,
      m: {},
      create: undefined,
      del: undefined,
      op: [{ p: ['name'], oi: 'Renamed' }],
    };
    const createOp: CreateOp = {
      c: 'tbl_bseTest',
      d: 'tblTest',
      v: 0,
      src: 'server',
      seq: 1,
      m: {},
      del: undefined,
      op: undefined,
      create: { type: 'json0', data: {} },
    };
    const deleteOp: DeleteOp = {
      c: 'tbl_bseTest',
      d: 'tblTest',
      v: 2,
      create: undefined,
      op: undefined,
      src: 'server',
      seq: 1,
      m: {},
      del: true,
    };

    expect(stripInstructionlessComponents(editOp)).toEqual(editOp);
    expect(stripInstructionlessComponents(createOp)).toEqual(createOp);
    expect(stripInstructionlessComponents(deleteOp)).toEqual(deleteOp);
  });
});
