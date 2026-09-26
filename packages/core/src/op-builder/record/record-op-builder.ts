/* eslint-disable @typescript-eslint/naming-convention */
import { OpName } from '../common';
import { OpBuilderAbstract } from '../op-builder.abstract';
import { AddRecordBuilder } from './add-record';
import { SetRecordBuilder } from './set-record';

export class RecordOpBuilder {
  static readonly editor = {
    [OpName.SetRecord]: new SetRecordBuilder(),
  };

  static readonly creator = new AddRecordBuilder();

  static readonly ops2Contexts = OpBuilderAbstract.ops2Contexts;

  static readonly detect = OpBuilderAbstract.detect;
}
