import type { IAttachmentCellValue, INumberShowAs, ISingleLineTextShowAs } from '@teable/core';
import { CellValueType, ColorUtils, FieldType, validateDateFieldValueLoose } from '@teable/core';
import { LRUCache } from 'lru-cache';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../../context/app/i18n/useTranslation';
import { useFields, useView } from '../../../hooks';
import type { IFieldInstance } from '../../../model';
import { getFileCover, isSystemFileIcon } from '../../editor';
import { GRID_DEFAULT } from '../../grid/configs';
import type { IGridColumn } from '../../grid/interface';
import type { ChartType, ICell, INumberShowAs as IGridNumberShowAs } from '../../grid/renderers';
import { CellType } from '../../grid/renderers';
import { convertNextImageUrl } from '../utils';

const cellValueStringCache: LRUCache<string, string> = new LRUCache({ max: 100 });

const { columnWidth } = GRID_DEFAULT;

const generateGroupColumns = (fields: IFieldInstance[]): IGridColumn[] => {
  const iconString = (type: FieldType, isLookup: boolean | undefined) => {
    return isLookup ? `${type}_lookup` : type;
  };

  return fields
    .map((field) => {
      if (!field) return;

      const { id, type, name, description, isLookup } = field;

      return {
        id,
        name,
        width: columnWidth,
        description,
        icon: iconString(type, isLookup),
      };
    })
    .filter(Boolean) as IGridColumn[];
};

const useGenerateGroupCellFn = () => {
  const { t } = useTranslation();
  return useCallback(
    (fields: IFieldInstance[]) =>
      // eslint-disable-next-line sonarjs/cognitive-complexity
      (_cellValue: unknown, depth: number): ICell => {
        const field = fields[depth];

        if (field == null) return { type: CellType.Loading };

        const { id: fieldId, type, isMultipleCellValue: isMultiple, cellValueType } = field;
        const emptyStr = '(Empty)';

        const validateCellValue =
          field.cellValueType === CellValueType.DateTime
            ? validateDateFieldValueLoose(_cellValue)
            : field.validateCellValue(_cellValue);
        const cellValue = (
          validateCellValue.success ? validateCellValue.data : undefined
        ) as unknown;

        if (cellValue == null) {
          return {
            type: CellType.Text,
            data: emptyStr,
            displayData: emptyStr,
          };
        }

        switch (type) {
          case FieldType.SingleLineText: {
            const { showAs } = field.options;

            if (showAs != null) {
              return {
                type: CellType.Link,
                data: cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [],
                displayData: field.cellValue2String(cellValue),
              };
            }

            return {
              type: CellType.Text,
              data: (cellValue as string) || emptyStr,
              displayData: field.cellValue2String(cellValue),
            };
          }
          case FieldType.LongText: {
            return {
              type: CellType.Text,
              data: (cellValue as string) || emptyStr,
              displayData: field.cellValue2String(cellValue),
              isWrap: true,
            };
          }
          case FieldType.Date:
          case FieldType.CreatedTime:
          case FieldType.LastModifiedTime: {
            let displayData = '';
            const { date, time, timeZone } = field.options.formatting;
            const cacheKey = `${fieldId}-${cellValue}-${date}-${time}-${timeZone}`;

            if (cellValueStringCache.has(cacheKey)) {
              displayData = cellValueStringCache.get(cacheKey) || '';
            } else {
              displayData = field.cellValue2String(cellValue);
              cellValueStringCache.set(cacheKey, displayData);
            }
            return {
              type: CellType.Text,
              data: (cellValue as string) || emptyStr,
              displayData,
            };
          }
          case FieldType.AutoNumber: {
            return {
              type: CellType.Number,
              data: cellValue as number,
              displayData: field.cellValue2String(cellValue),
              contentAlign: 'left',
            };
          }
          case FieldType.Number:
          case FieldType.Rollup:
          case FieldType.Formula: {
            if (cellValueType === CellValueType.Boolean) {
              return {
                type: CellType.Boolean,
                data: (cellValue as boolean) || false,
                isMultiple,
              };
            }

            if (cellValueType === CellValueType.DateTime) {
              return {
                type: CellType.Text,
                data: (cellValue as string) || emptyStr,
                displayData: (cellValue as string) || emptyStr,
              };
            }

            if (cellValueType === CellValueType.String) {
              const showAs = field.options.showAs as ISingleLineTextShowAs;

              if (showAs != null) {
                return {
                  type: CellType.Link,
                  data: cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [],
                  displayData: field.cellValue2String(cellValue),
                };
              }

              return {
                type: CellType.Text,
                data: (cellValue as string) || emptyStr,
                displayData: field.cellValue2String(cellValue),
              };
            }

            const optionShowAs = field.options.showAs as INumberShowAs;
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
                displayData: cellValue.map((v) => field.item2String(v)),
                chartType: showAs.type as unknown as ChartType,
                color: showAs.color,
              };
            }

            return {
              type: CellType.Number,
              data: cellValue as number,
              displayData:
                isMultiple && Array.isArray(cellValue)
                  ? cellValue.map((v) => field.item2String(v))
                  : field.cellValue2String(cellValue),
              showAs: showAs as unknown as IGridNumberShowAs,
              contentAlign: 'left',
            };
          }
          case FieldType.MultipleSelect:
          case FieldType.SingleSelect: {
            const data = cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [];
            return {
              type: CellType.Select,
              data,
              displayData: data,
              choiceSorted: field.options.choices,
              choiceMap: field.displayChoiceMap,
              isMultiple,
            };
          }
          case FieldType.Link: {
            const cv = cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [];
            const displayData = cv.map(({ title }) => title || t('common.untitled'));
            const choices = cv.map(({ id, title }) => ({ id, name: title }));
            return {
              type: CellType.Select,
              data: cv,
              displayData,
              choiceSorted: choices,
              isMultiple,
            };
          }
          case FieldType.Attachment: {
            const cv = (cellValue ?? []) as IAttachmentCellValue;
            const data = cv.map(({ id, mimetype, presignedUrl, smThumbnailUrl }) => {
              const url = getFileCover(mimetype, presignedUrl);
              return {
                id,
                url: isSystemFileIcon(mimetype) ? url : smThumbnailUrl ?? url,
              };
            });
            const displayData = data.map(({ url }) => url);
            return {
              type: CellType.Image,
              data,
              displayData,
            };
          }
          case FieldType.Checkbox: {
            return {
              type: CellType.Boolean,
              data: (cellValue as boolean) || false,
              isMultiple,
              contentAlign: 'left',
            };
          }
          case FieldType.Rating: {
            const { icon, color, max } = field.options;

            if (isMultiple) {
              return {
                type: CellType.Number,
                data: cellValue as number,
                displayData: field.cellValue2String(cellValue),
                contentAlign: 'left',
              };
            }

            return {
              type: CellType.Rating,
              data: (cellValue as number) || 0,
              icon,
              color: ColorUtils.getHexForColor(color),
              max,
            };
          }
          case FieldType.User:
          case FieldType.CreatedBy:
          case FieldType.LastModifiedBy: {
            const cv = cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [];
            const data = cv.map((item) => {
              const { title, avatarUrl } = item;
              return {
                ...item,
                name: title,
                avatarUrl: convertNextImageUrl({
                  url: avatarUrl,
                  w: 64,
                  q: 100,
                }),
              };
            });

            return {
              type: CellType.User,
              data: data,
            };
          }
          default: {
            return { type: CellType.Loading };
          }
        }
      },
    [t]
  );
};

export const useGridGroupCollection = () => {
  const view = useView();
  const group = view?.group;
  const fields = useFields({ withHidden: true, withDenied: true });

  const groupFields = useMemo(() => {
    if (!group?.length) return [];

    return group
      .map(({ fieldId }) => fields.find((f) => f.id === fieldId))
      .filter(Boolean) as IFieldInstance[];
  }, [fields, group]);

  const generateGroupCellFn = useGenerateGroupCellFn();

  return useMemo(
    () => ({
      groupColumns: generateGroupColumns(groupFields),
      getGroupCell: generateGroupCellFn(groupFields),
    }),
    [generateGroupCellFn, groupFields]
  );
};
