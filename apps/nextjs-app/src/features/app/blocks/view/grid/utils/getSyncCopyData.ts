import type { IFieldVo } from '@teable/core';
import { fieldVoSchema, stringifyClipboardText } from '@teable/core';
import {
  type IRecordIndexMap,
  type CombinedSelection,
  type Field,
  SelectionRegionType,
} from '@teable/sdk';

export const getSyncCopyData = ({
  recordMap,
  fields,
  selection,
}: {
  recordMap: IRecordIndexMap;
  fields: Field[];
  selection: CombinedSelection;
}) => {
  const ranges = selection.serialize();
  const content: string[][] = [];
  let headers: IFieldVo[] = [];

  switch (selection.type) {
    case SelectionRegionType.Cells: {
      const [[startColumnIndex, startRowIndex], [endColumnIndex, endRowIndex]] = ranges;
      headers = fields
        .slice(startColumnIndex, endColumnIndex + 1)
        .map((field) => fieldVoSchema.parse(field));
      for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
        const rowContent: string[] = [];
        for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
          const record = recordMap[rowIndex];
          const field = fields[columnIndex];
          const fieldValue = field.cellValue2String(record?.fields[field.id]);
          rowContent.push(fieldValue);
        }
        content.push(rowContent);
      }
      break;
    }
    case SelectionRegionType.Rows: {
      const len = ranges.length;
      headers = fields.map((field) => fieldVoSchema.parse(field));
      for (let i = 0; i < len; i++) {
        const [startRowIndex, endRowIndex] = ranges[i];
        for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
          const rowContent: string[] = fields.map((field) => {
            const record = recordMap[rowIndex];
            return field.cellValue2String(record?.fields[field.id]);
          });
          content.push(rowContent);
        }
      }
      break;
    }
    case SelectionRegionType.Columns: {
      const len = ranges.length;
      let selectedFields: Field[] = [];
      for (let i = 0; i < len; i++) {
        const [startColIndex, endColIndex] = ranges[i];
        selectedFields = selectedFields.concat(
          fields.slice(startColIndex, endColIndex + 1).map((field) => field)
        );
      }
      Object.keys(recordMap)
        .sort()
        .forEach((recordIndex) => {
          const record = recordMap[recordIndex];
          if (!record) return;
          const rowContent: string[] = selectedFields.map((field) =>
            field.cellValue2String(record.fields[field.id])
          );
          content.push(rowContent);
        });

      headers = selectedFields.map((field) => fieldVoSchema.parse(field));
      break;
    }
    default:
      throw new Error('Unsupported selection type');
  }
  const contentString = stringifyClipboardText(content);
  return { content: contentString, header: headers };
};
