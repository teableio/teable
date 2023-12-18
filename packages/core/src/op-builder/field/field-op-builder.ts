/* eslint-disable @typescript-eslint/naming-convention */
import { OpName } from '../common';
import { OpBuilderAbstract } from '../op-builder.abstract';
import { AddColumnMetaBuilder } from './add-column-meta';
import { AddFieldBuilder } from './add-field';
import { DeleteColumnMetaBuilder } from './delete-column-meta';
import { SetFieldPropertyBuilder } from './set-field-property';

export class FieldOpBuilder {
  static editor = {
    [OpName.AddColumnMeta]: new AddColumnMetaBuilder(),
    [OpName.DeleteColumnMeta]: new DeleteColumnMetaBuilder(),

    [OpName.SetFieldProperty]: new SetFieldPropertyBuilder(),
  };

  static creator = new AddFieldBuilder();

  static ops2Contexts = OpBuilderAbstract.ops2Contexts;

  static detect = OpBuilderAbstract.detect;
}
