/* eslint-disable @typescript-eslint/naming-convention */
import { OpBuilderAbstract } from '../op-builder.abstract';
import { AddColumnMetaBuilder } from './add-column-meta';
import { AddFieldBuilder } from './add-field';
import { DeleteColumnMetaBuilder } from './delete-column-meta';
import { SetColumnMetaBuilder } from './set-column-meta';
import { SetFieldDescriptionBuilder } from './set-field-description';
import { SetFieldNameBuilder } from './set-field-name';
import { SetFieldOptionsBuilder } from './set-field-options';
import { SetFieldTypeBuilder } from './set-field-type';

export class FieldOpBuilder {
  static editor = {
    addColumnMeta: new AddColumnMetaBuilder(),
    deleteColumnMeta: new DeleteColumnMetaBuilder(),
    setColumnMeta: new SetColumnMetaBuilder(),
    setFieldName: new SetFieldNameBuilder(),
    setFieldDescription: new SetFieldDescriptionBuilder(),
    setFieldOptions: new SetFieldOptionsBuilder(),
    setFieldType: new SetFieldTypeBuilder(),
  };

  static creator = new AddFieldBuilder();

  static ops2Contexts = OpBuilderAbstract.ops2Contexts;

  static detect = OpBuilderAbstract.detect;
}
