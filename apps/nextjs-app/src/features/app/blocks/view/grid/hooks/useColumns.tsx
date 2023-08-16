import { CellValueType, ColorUtils, FieldType, formatNumberToString } from '@teable-group/core';
import type { IAttachmentCellValue, INumberFormatting } from '@teable-group/core';
import { useFields, useViewId } from '@teable-group/sdk/hooks';
import type { IFieldInstance, Record } from '@teable-group/sdk/model';
import { LRUCache } from 'lru-cache';
import { useMemo } from 'react';
import colors from 'tailwindcss/colors';
import { getFileCover } from '@/features/app/utils';
import type { IGridColumn, ICell, INumberShowAs, ChartType } from '../../../grid';
import { CellType, EditorPosition } from '../../../grid';
import { DateEditor, LinkEditor } from '../components';
import { AttachmentEditor } from '../components/editor/AttachmentEditor';

const cellValueStringCache: LRUCache<string, string> = new LRUCache({ max: 1000 });

const generateColumns = (
  fields: IFieldInstance[],
  viewId?: string
): (IGridColumn & { id: string })[] => {
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
        customTheme: field.hasError ? { columnHeaderBg: colors.rose[100] } : undefined,
        hasMenu: true,
        icon: iconString(type, isLookup),
      };
    })
    .filter(Boolean) as (IGridColumn & { id: string })[];
};

const createCellValue2GridDisplay =
  (fields: IFieldInstance[]) =>
  // eslint-disable-next-line sonarjs/cognitive-complexity
  (record: Record, col: number): ICell => {
    const field = fields[col];

    if (field == null) return { type: CellType.Loading };

    const { id, type, isComputed, isMultipleCellValue: isMultiple, cellValueType } = field;
    const cellValue = record.getCellValue(id);

    switch (type) {
      case FieldType.SingleLineText: {
        return {
          type: CellType.Text,
          data: (cellValue as string) || '',
          displayData: field.cellValue2String(cellValue),
          readonly: isComputed,
        };
      }
      case FieldType.Date: {
        let displayData = '';
        const cacheKey = `${id}-${cellValue}`;

        if (cellValueStringCache.has(cacheKey)) {
          displayData = cellValueStringCache.get(cacheKey) || '';
        } else {
          displayData = field.cellValue2String(cellValue);
          cellValueStringCache.set(cacheKey, displayData);
        }
        return {
          type: CellType.Text,
          data: (cellValue as string) || '',
          displayData,
          readonly: isComputed,
          editorPosition: EditorPosition.Below,
          customEditor: (props) => <DateEditor field={field} record={record} {...props} />,
        };
      }
      case FieldType.Number:
      case FieldType.Rollup:
      case FieldType.Formula: {
        if (cellValueType !== CellValueType.Number) {
          return {
            type: CellType.Text,
            data: (cellValue as string) || '',
            displayData: field.cellValue2String(cellValue),
            readonly: isComputed,
          };
        }

        const { showAs: optionShowAs, formatting } = field.options;
        const showAs =
          optionShowAs == null
            ? undefined
            : {
                ...optionShowAs,
                color: ColorUtils.getHexForColor(optionShowAs.color),
              };

        if (showAs && isMultiple && Array.isArray(cellValue)) {
          return {
            type: CellType.Chart,
            data: cellValue as number[],
            displayData: cellValue.map((v) =>
              formatNumberToString(v, formatting as INumberFormatting)
            ),
            readonly: isComputed,
            chartType: showAs.type as unknown as ChartType,
            color: showAs.color,
          };
        }

        return {
          type: CellType.Number,
          data: cellValue as number,
          displayData: field.cellValue2String(cellValue),
          readonly: isComputed,
          showAs: showAs as unknown as INumberShowAs,
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
          customEditor: (props) => <LinkEditor field={field} record={record} {...props} />,
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
        return { type: CellType.Loading };
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
