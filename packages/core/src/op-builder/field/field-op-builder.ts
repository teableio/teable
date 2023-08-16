/* eslint-disable @typescript-eslint/naming-convention */
import { OpBuilderAbstract } from '../op-builder.abstract';
import { AddColumnMetaBuilder } from './add-column-meta';
import { AddFieldBuilder } from './add-field';
import { DeleteColumnMetaBuilder } from './delete-column-meta';
import { SetColumnMetaBuilder } from './set-column-meta';
import { SetFieldPropertyBuilder } from './set-field-property';

export class FieldOpBuilder {
  static editor = {
    addColumnMeta: new AddColumnMetaBuilder(),
    deleteColumnMeta: new DeleteColumnMetaBuilder(),
    setColumnMeta: new SetColumnMetaBuilder(),

    setFieldProperty: new SetFieldPropertyBuilder(),
  };

  static creator = new AddFieldBuilder();

  static ops2Contexts = OpBuilderAbstract.ops2Contexts;

  static detect = OpBuilderAbstract.detect;
}
