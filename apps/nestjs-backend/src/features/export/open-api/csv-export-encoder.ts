import type { IAttachmentCellValue, IFieldVo } from '@teable/core';
import { FieldType } from '@teable/core';
import Papa from 'papaparse';
import type { IFieldInstance } from '../../field/model/factory';
import { createFieldInstanceByVo } from '../../field/model/factory';

type CsvRecord = Readonly<{ fields: Record<string, unknown> }>;

export class CsvExportEncoder {
  private readonly headerInfo: Map<
    string,
    {
      index: number;
      type: IFieldVo['type'];
      fieldInstance: IFieldInstance;
    }
  >;

  constructor(private readonly headers: readonly IFieldVo[]) {
    this.headerInfo = new Map(
      headers.map((field, index) => [
        field.name,
        {
          index,
          type: field.type,
          fieldInstance: createFieldInstanceByVo(field),
        },
      ])
    );
  }

  header(): string {
    return Papa.unparse([this.headers.map(({ name }) => name)]);
  }

  encode(records: readonly CsvRecord[]): string {
    return Papa.unparse(
      records.map(({ fields }) => {
        const row = Array.from({ length: this.headers.length });
        for (const [key, value] of Object.entries(fields)) {
          const info = this.headerInfo.get(key);
          if (!info) continue;
          row[info.index] =
            info.type === FieldType.Attachment
              ? (value as IAttachmentCellValue)
                  .map((attachment) => `${attachment.name} ${attachment.presignedUrl}`)
                  .join(',')
              : info.fieldInstance.cellValue2String(value);
        }
        return row;
      })
    );
  }
}
