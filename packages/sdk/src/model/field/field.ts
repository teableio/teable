import { FieldCore, IFieldSnapshot, OpBuilder } from '@teable-group/core';
import { Doc } from 'sharedb/lib/client';

export class FieldExtended {
  static updateName(doc: Doc<IFieldSnapshot>, name: string, oldName: string) {
    const fieldOperation = OpBuilder.editor.setFieldName.build({
      newName: name,
      oldName: oldName,
    });

    return new Promise<void>((resolve, reject) => {
      doc.submitOp([fieldOperation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}

export abstract class Field extends FieldCore {
  abstract updateName(name: string): Promise<void>;
}
