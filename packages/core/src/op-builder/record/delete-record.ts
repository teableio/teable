import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IDeleteRecordOpContext {
  name: OpName.DeleteRecord;
  recordId: string;
}

export class DeleteRecordBuilder implements IOpBuilder {
  name: OpName.DeleteRecord = OpName.DeleteRecord;

  build(recordId: string): IOtOperation {
    return {
      p: ['recordMap', recordId],
      od: {
        id: recordId,
        fields: {},
      },
    };
  }

  detect(op: IOtOperation): IDeleteRecordOpContext | null {
    const { p, od, oi } = op;

    if (!od || oi) {
      return null;
    }

    const result = pathMatcher<{ recordId: string }>(p, ['recordMap', ':recordId']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      recordId: result.recordId,
    };
  }
}
