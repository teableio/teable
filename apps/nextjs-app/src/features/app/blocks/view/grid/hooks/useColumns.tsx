import type { IAttachmentCellValue } from '@teable-group/core';
import { ColorUtils, FieldType } from '@teable-group/core';
import { useFields, useViewId } from '@teable-group/sdk/hooks';
import type { IFieldInstance, Record } from '@teable-group/sdk/model';
import { useMemo } from 'react';
import { getFileCover } from '@/features/app/utils';
import type { IColumn, ICell } from '../../../grid';
import { CellType, EditorPosition } from '../../../grid';
import { DateEditor, LinkEditor } from '../components';
import { AttachmentEditor } from '../components/editor/AttachmentEditor';

const generateColumns = (
  fields: IFieldInstance[],
  viewId?: string
): (IColumn & { id: string })[] => {
  if (!viewId) {
    return [];
  }

  const iconString = (type: FieldType, isLookup: boolean | undefined) => {
    return isLookup ? `${type}_lookup` : type;
  };

  return fields
    .map((field) => {
      if (!field) return undefined;
      const columnMeta = field.columnMeta[viewId];
      const width = columnMeta?.width || 150;
      const { id, type, name, isLookup } = field;
      return {
        id,
        name,
        width,
        hasMenu: true,
        icon: iconString(type, isLookup),
      };
    })
    .filter(Boolean) as (IColumn & { id: string })[];
};

const createCellValue2GridDisplay =
  (fields: IFieldInstance[]) =>
  // eslint-disable-next-line sonarjs/cognitive-complexity
  (record: Record, col: number): ICell => {
    const field = fields[col];
    const { id, type, isComputed, isMultipleCellValue: isMultiple } = field;
    const cellValue = record.getCellValue(id);

    switch (type) {
      case FieldType.Date:
      case FieldType.SingleLineText: {
        const isDateField = type === FieldType.Date;
        return {
          type: CellType.Text,
          data: (cellValue as string) || '',
          displayData: field.cellValue2String(cellValue),
          readonly: isComputed,
          editorPosition: isDateField ? EditorPosition.Below : EditorPosition.Overlap,
          customEditor: isDateField
            ? (props) => <DateEditor field={field} record={record} {...props} />
            : undefined,
        };
      }
      case FieldType.Number: {
        return {
          type: CellType.Number,
          data: (cellValue as number) || undefined,
          displayData: field.cellValue2String(cellValue),
          readonly: isComputed,
        };
      }
      case FieldType.MultipleSelect:
      case FieldType.SingleSelect: {
        const data = cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [];
        const choices = field.options.choices.map(({ name, color }) => {
          return {
            name,
            bgColor: ColorUtils.getHexForColor(color),
            textColor: ColorUtils.shouldUseLightTextOnColor(color) ? '#FFFFFF' : '#000000',
          };
        });
        return {
          type: CellType.Select,
          data,
          choices,
          readonly: isComputed,
          isMultiple,
          editorPosition: EditorPosition.Below,
        };
      }
      case FieldType.Link: {
        const cv = cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [];
        const data = cv.map(({ title }) => title || 'Untitled');
        const choices = cv.map(({ id, title }) => ({ id, name: title }));
        return {
          type: CellType.Select,
          data,
          choices,
          readonly: false,
          isMultiple,
          editorPosition: EditorPosition.Below,
          customEditor: (props, ref) => (
            <LinkEditor editorRef={ref} field={field} record={record} {...props} />
          ),
        };
      }
      case FieldType.Attachment: {
        const cv = (cellValue ?? []) as IAttachmentCellValue;
        const data = cv.map(({ id, mimetype, url }) => ({ id, url: getFileCover(mimetype, url) }));
        const displayData = data.map(({ url }) => url);
        return {
          type: CellType.Image,
          data,
          displayData,
          readonly: isComputed,
          customEditor: (props) => <AttachmentEditor field={field} record={record} {...props} />,
        };
      }
      case FieldType.Checkbox: {
        return {
          type: CellType.Boolean,
          data: (cellValue as boolean) || false,
          readonly: isComputed,
          isMultiple,
        };
      }
      default: {
        return {
          type: CellType.Loading,
        };
      }
    }
  };

export function useColumns() {
  const viewId = useViewId();
  const fields = useFields();

  return useMemo(
    () => ({
      columns: generateColumns(fields, viewId),
      cellValue2GridDisplay: createCellValue2GridDisplay(fields),
    }),
    [fields, viewId]
  );
}
