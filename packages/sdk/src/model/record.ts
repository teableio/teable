import type { IRecordFields, IRecordSnapshot } from '@teable-group/core';
import { OpBuilder, RecordCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import type { IFieldInstance } from './field/factory';

export class Record extends RecordCore {
  constructor(
    protected doc: Doc<IRecordSnapshot>,
    protected fields: { [fieldId: string]: IFieldInstance },
    protected data: IRecordFields
  ) {
    super(fields, data);
  }

  async clearCell(fieldId: string) {
    const operation = OpBuilder.editor.setRecord.build({
      fieldId,
      newCellValue: null,
      oldCellValue: this.data[fieldId],
    });

    return new Promise((resolve, reject) => {
      this.doc.submitOp([operation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }

  async updateCell(fieldId: string, cellValue: unknown) {
    const operation = OpBuilder.editor.setRecord.build({
      fieldId,
      newCellValue: cellValue,
      oldCellValue: this.data[fieldId],
    });

    return new Promise((resolve, reject) => {
      this.doc.submitOp([operation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}
