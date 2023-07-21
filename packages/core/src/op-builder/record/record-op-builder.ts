/* eslint-disable @typescript-eslint/naming-convention */
import { OpBuilderAbstract } from '../op-builder.abstract';
import { AddRecordBuilder } from './add-record';
import { SetRecordBuilder } from './set-record';
import { SetRecordOrderBuilder } from './set-record-order';

export class RecordOpBuilder {
  static editor = {
    setRecord: new SetRecordBuilder(),
    setRecordOrder: new SetRecordOrderBuilder(),
  };

  static creator = new AddRecordBuilder();

  static ops2Contexts = OpBuilderAbstract.ops2Contexts;

  static detect = OpBuilderAbstract.detect;
}
