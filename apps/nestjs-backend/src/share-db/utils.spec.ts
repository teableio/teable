import { describe, expect, it } from 'vitest';
import { stripInstructionlessComponents } from './utils';

describe('stripInstructionlessComponents', () => {
  it('removes a component that carries no json0 instruction', () => {
    const op = {
      c: 'viw_tblTest',
      d: 'viwTest',
      v: 3,
      op: [{ p: ['name'], oi: 'Renamed' }, { p: ['filter'] }],
    };

    expect(stripInstructionlessComponents(op)).toEqual({
      c: 'viw_tblTest',
      d: 'viwTest',
      v: 3,
      op: [{ p: ['name'], oi: 'Renamed' }],
    });
  });

  it('drops an op whose components are all instruction-less', () => {
    const op = { c: 'viw_tblTest', d: 'viwTest', v: 3, op: [{ p: ['filter'] }] };

    expect(stripInstructionlessComponents(op)).toBeUndefined();
  });

  it('keeps explicit nulls, which are instructions', () => {
    const op = {
      c: 'viw_tblTest',
      d: 'viwTest',
      v: 3,
      op: [{ p: ['filter'], od: null, oi: null }],
    };

    expect(stripInstructionlessComponents(op)).toEqual(op);
  });

  it('passes through ops without a component list and ops that are fully applicable', () => {
    const editOp = { c: 'tbl_bseTest', d: 'tblTest', v: 2, op: [{ p: ['name'], oi: 'Renamed' }] };
    const createOp = { c: 'tbl_bseTest', d: 'tblTest', create: { type: 'json0', data: {} } };
    const deleteOp = { c: 'tbl_bseTest', d: 'tblTest', del: true };

    expect(stripInstructionlessComponents(editOp)).toEqual(editOp);
    expect(stripInstructionlessComponents(createOp)).toEqual(createOp);
    expect(stripInstructionlessComponents(deleteOp)).toEqual(deleteOp);
  });
});
