/* eslint-disable @typescript-eslint/naming-convention */
import { OpName } from '../common';
import { OpBuilderAbstract } from '../op-builder.abstract';
import { AddTableBuilder } from './add-table';
import { SetTablePropertyBuilder } from './set-table-property';

export class TableOpBuilder {
  static readonly editor = {
    [OpName.SetTableProperty]: new SetTablePropertyBuilder(),
  };

  static readonly creator = new AddTableBuilder();

  static readonly ops2Contexts = OpBuilderAbstract.ops2Contexts;

  static readonly detect = OpBuilderAbstract.detect;
}
