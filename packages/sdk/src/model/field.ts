import { FieldCore, IFieldSnapshot, OpBuilder } from '@teable-group/core';
import { Doc } from 'sharedb/lib/client';

export abstract class Field extends FieldCore {
  constructor(private doc: Doc<IFieldSnapshot>) {
    super();
  }

  async updateName(name: string) {
    const fieldOperation = OpBuilder.editor.setFieldName.build({
      newName: name,
      oldName: this.name,
    });

    return new Promise((resolve, reject) => {
      this.doc.submitOp([fieldOperation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}
