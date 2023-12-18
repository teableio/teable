/* eslint-disable @typescript-eslint/naming-convention */
import { OpName } from '../common';
import { OpBuilderAbstract } from '../op-builder.abstract';
import { AddRecordBuilder } from './add-record';
import { SetRecordBuilder } from './set-record';
import { SetRecordOrderBuilder } from './set-record-order';

export class RecordOpBuilder {
  static editor = {
    [OpName.SetRecord]: new SetRecordBuilder(),
    [OpName.SetRecordOrder]: new SetRecordOrderBuilder(),
  };

  static creator = new AddRecordBuilder();

  static ops2Contexts = OpBuilderAbstract.ops2Contexts;

  static detect = OpBuilderAbstract.detect;
}
