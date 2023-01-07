import type { IRecordSnapshot } from '../../models';
import { OpName } from '../common';
import type { ICreateOpBuilder } from '../interface';

export class AddRecordBuilder implements ICreateOpBuilder {
  name: OpName.AddRecord = OpName.AddRecord;

  // you should only build an empty record
  build(recordId: string): IRecordSnapshot {
    return {
      record: {
        id: recordId,
        fields: {},
      },
      recordOrder: {},
    };
  }
}
