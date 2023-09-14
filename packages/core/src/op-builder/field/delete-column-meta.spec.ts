/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IOtOperation } from '../../models';
import { OpName } from '../common';
import { DeleteColumnMetaBuilder } from './delete-column-meta';

describe('DeleteColumnMetaBuilder', () => {
  let builder: DeleteColumnMetaBuilder;

  beforeEach(() => {
    builder = new DeleteColumnMetaBuilder();
  });

  it('should correctly build IOtOperation for deleting column meta', () => {
    const params = {
      viewId: 'testView',
      oldMetaValue: { columnName: 'testColumn' } as any,
    };

    const result = builder.build(params);

    expect(result).toEqual({
      p: ['columnMeta', 'testView'],
      od: { columnName: 'testColumn' },
    });
  });

  it('should detect IOtOperation and return IDeleteColumnMetaOpContext', () => {
    const op: IOtOperation = {
      p: ['columnMeta', 'testView'],
      od: { columnName: 'testColumn' },
    };

    const result = builder.detect(op);

    expect(result).toEqual({
      name: OpName.DeleteColumnMeta,
      viewId: 'testView',
      oldMetaValue: { columnName: 'testColumn' },
    });
  });

  it('should return null if IOtOperation has `oi` property', () => {
    const op: IOtOperation = {
      p: ['columnMeta', 'testView'],
      od: { columnName: 'testColumn' },
      oi: { columnName: 'newColumn' },
    };

    const result = builder.detect(op);

    expect(result).toBeNull();
  });

  it('should return null for undetectable IOtOperation', () => {
    const op: IOtOperation = {
      p: ['otherPath', 'testView'],
      od: { columnName: 'testColumn' },
    };

    const result = builder.detect(op);

    expect(result).toBeNull();
  });
});
