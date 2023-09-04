/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IOtOperation } from '../../models';
import { OpName } from '../common';
import { SetColumnMetaBuilder } from './set-column-meta';

describe('SetColumnMetaBuilder', () => {
  let builder: SetColumnMetaBuilder;

  beforeEach(() => {
    builder = new SetColumnMetaBuilder();
  });

  it('should correctly build IOtOperation for setting column meta', () => {
    const params = {
      viewId: 'testView',
      metaKey: 'columnName',
      newMetaValue: 'newName',
      oldMetaValue: 'oldName',
    };

    const result = builder.build(params as any);

    expect(result).toEqual({
      p: ['columnMeta', 'testView', 'columnName'],
      oi: 'newName',
      od: 'oldName',
    });
  });

  it('should omit oldMetaValue if not provided', () => {
    const params = {
      viewId: 'testView',
      metaKey: 'columnName',
      newMetaValue: 'newName',
    };

    const result = builder.build(params as any);

    expect(result).toEqual({
      p: ['columnMeta', 'testView', 'columnName'],
      oi: 'newName',
    });
  });

  it('should detect IOtOperation and return ISetColumnMetaOpContext', () => {
    const op: IOtOperation = {
      p: ['columnMeta', 'testView', 'columnName'],
      oi: 'newName',
      od: 'oldName',
    };

    const result = builder.detect(op);

    expect(result).toEqual({
      name: OpName.SetColumnMeta,
      viewId: 'testView',
      metaKey: 'columnName',
      newMetaValue: 'newName',
      oldMetaValue: 'oldName',
    });
  });

  it('should return null for undetectable IOtOperation', () => {
    const op: IOtOperation = {
      p: ['otherPath', 'testView', 'columnName'],
      oi: 'newName',
      od: 'oldName',
    };

    const result = builder.detect(op);

    expect(result).toBeNull();
  });
});
