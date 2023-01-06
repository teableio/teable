import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface IAddRecordOpContext {
  name: OpName.AddRecord;
  recordId: string;
}

export class AddRecordBuilder implements IOpBuilder {
  name: OpName.AddRecord = OpName.AddRecord;

  // you should only build an empty record
  build(recordId: string): IOtOperation {
    return {
      p: ['record'],
      oi: {
        id: recordId,
        fields: {},
      },
    };
  }

  detect(op: IOtOperation): IAddRecordOpContext | null {
    const { p, oi, od } = op;
    if (!oi || od) {
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
