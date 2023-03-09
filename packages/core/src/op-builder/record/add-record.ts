import type { IRecordSnapshot } from '../../models';
import { OpName } from '../common';
import type { ICreateOpBuilder } from '../interface';

export class AddRecordBuilder implements ICreateOpBuilder {
  name: OpName.AddRecord = OpName.AddRecord;

  // you should only build an empty record
  build(record: IRecordSnapshot): IRecordSnapshot {
    return {
      record: {
        id: record.record.id,
        fields: {},
      },
      recordOrder: {},
    };
  }
}
