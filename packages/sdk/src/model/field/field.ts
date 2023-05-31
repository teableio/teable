import type { IFieldSnapshot } from '@teable-group/core';
import { FieldCore, OpBuilder } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';

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

  static updateColumnWidth(
    doc: Doc<IFieldSnapshot>,
    viewId: string,
    newWidth: number,
    oldWidth?: number
  ) {
    const fieldOperation = OpBuilder.editor.setColumnMeta.build({
      viewId,
      metaKey: 'width',
      oldMetaValue: oldWidth,
      newMetaValue: newWidth,
    });

    return new Promise<void>((resolve, reject) => {
      doc.submitOp([fieldOperation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }

  static delete(doc: Doc<IFieldSnapshot>) {
    return new Promise<void>((resolve, reject) => {
      doc.del({}, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}

export abstract class Field extends FieldCore {
  abstract updateName(name: string): Promise<void>;
  abstract updateColumnWidth(viewId: string, width: number): Promise<void>;
  abstract delete(): Promise<void>;
}
