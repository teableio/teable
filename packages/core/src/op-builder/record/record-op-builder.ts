/* eslint-disable @typescript-eslint/naming-convention */
import { OpName } from '../common';
import { OpBuilderAbstract } from '../op-builder.abstract';
import { AddRecordBuilder } from './add-record';
import { SetRecordBuilder } from './set-record';

export class RecordOpBuilder {
  static editor = {
    [OpName.SetRecord]: new SetRecordBuilder(),
  };

  static creator = new AddRecordBuilder();

  static ops2Contexts = OpBuilderAbstract.ops2Contexts;

  static detect = OpBuilderAbstract.detect;
}
