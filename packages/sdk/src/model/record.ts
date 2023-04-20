import type { IRecordSnapshot } from '@teable-group/core';
import { OpBuilder, RecordCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import type { IFieldInstance } from './field/factory';

export class Record extends RecordCore {
  constructor(
    protected doc: Doc<IRecordSnapshot>,
    protected fieldMap: { [fieldId: string]: IFieldInstance }
  ) {
    super(fieldMap);
  }

  async clearCell(fieldId: string) {
    const operation = OpBuilder.editor.setRecord.build({
      fieldId,
      newCellValue: null,
      oldCellValue: this.fields[fieldId],
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
      oldCellValue: this.fields[fieldId],
    });

    return new Promise((resolve, reject) => {
      this.doc.submitOp([operation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}
