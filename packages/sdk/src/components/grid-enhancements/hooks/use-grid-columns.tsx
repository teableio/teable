import type { IAttachmentCellValue, INumberShowAs, ISingleLineTextShowAs } from '@teable/core';
import { RowHeightLevel, CellValueType, ColorUtils, FieldType } from '@teable/core';
import { useTheme } from '@teable/next-themes';
import { keyBy } from 'lodash';
import { LRUCache } from 'lru-cache';
import { useCallback, useMemo } from 'react';
import colors from 'tailwindcss/colors';
import type { ChartType, ICell, IGridColumn, INumberShowAs as IGridNumberShowAs } from '../..';
import {
  CellType,
  hexToRGBA,
  getFileCover,
  isSystemFileIcon,
  convertNextImageUrl,
  onMixedTextClick,
} from '../..';
import { useTranslation } from '../../../context/app/i18n/useTranslation';
import { useFields, useView, useFieldCellEditable } from '../../../hooks';
import type { IFieldInstance, NumberField, Record } from '../../../model';
import type { GridView } from '../../../model/view';
import { getFilterFieldIds } from '../../filter/view-filter/utils';
import type { IGridTheme } from '../../grid/configs';
import { GRID_DEFAULT } from '../../grid/configs';
import { useAttachmentPreviewI18Map } from '../../hooks';
import {
  GridAttachmentEditor,
  GridDateEditor,
  GridLinkEditor,
  GridNumberEditor,
  GridSelectEditor,
  expandPreviewModal,
} from '../editor';
import { GridUserEditor } from '../editor/GridUserEditor';

const cellValueStringCache: LRUCache<string, string> = new LRUCache({ max: 1000 });

const iconString = (type: FieldType, isLookup: boolean | undefined) => {
  return isLookup ? `${type}_lookup` : type;
};

interface IGenerateColumnsProps {
  fields: IFieldInstance[];
  view?: GridView;
  hasMenu?: boolean;
  theme?: string;
  sortFieldIds?: Set<string>;
  groupFieldIds?: Set<string>;
  filterFieldIds?: Set<string>;
}

const getColumnThemeByField = ({
  field,
  theme,
  sortFieldIds,
  groupFieldIds,
  filterFieldIds,
}: Pick<IGenerateColumnsProps, 'theme' | 'sortFieldIds' | 'groupFieldIds' | 'filterFieldIds'> & {
  field: IFieldInstance;
}) => {
  const { id, isPending, hasError } = field;
  const { orange, green, violet, rose, yellow } = colors;
  const isDark = theme === 'dark';
  const color_50 = isDark ? 700 : 50;
  const color_100 = isDark ? 500 : 100;
  const color_200 = isDark ? 400 : 200;
  const opacity = isDark ? 0.3 : 0.8;
  const colorMap = {
    sort: orange,
    group: green,
    filter: violet,
  };

  let customTheme: Partial<IGridTheme> | undefined = undefined;
  let conditionColorObj = undefined;

  if (groupFieldIds?.has(id)) {
    conditionColorObj = colorMap.group;
  }

  if (sortFieldIds?.has(id)) {
    conditionColorObj = colorMap.sort;
  }

  if (filterFieldIds?.has(id)) {
    conditionColorObj = colorMap.filter;
  }

  if (conditionColorObj != null) {
    customTheme = {
      cellBg: hexToRGBA(conditionColorObj[color_50], opacity),
      cellBgHovered: hexToRGBA(conditionColorObj[color_50], opacity),
      cellBgSelected: hexToRGBA(conditionColorObj[color_100], opacity),
      columnHeaderBg: hexToRGBA(conditionColorObj[color_100], opacity),
      columnHeaderBgHovered: hexToRGBA(conditionColorObj[color_200], opacity),
      columnHeaderBgSelected: hexToRGBA(conditionColorObj[color_200], opacity),
    };
  }

  if (hasError || isPending) {
    const colorObj = hasError ? rose : yellow;

    customTheme = {
      ...customTheme,
      columnHeaderBg: hexToRGBA(colorObj[color_100], opacity),
      columnHeaderBgHovered: hexToRGBA(colorObj[color_200], opacity),
      columnHeaderBgSelected: hexToRGBA(colorObj[color_200], opacity),
    };
  }

  return customTheme;
};

const useGenerateColumns = () => {
  const { t } = useTranslation();
  return useCallback(
    ({
      fields,
      view,
      theme,
      hasMenu = true,
      sortFieldIds,
      groupFieldIds,
      filterFieldIds,
    }: IGenerateColumnsProps): (IGridColumn & { id: string })[] => {
      return fields
        .map((field, i) => {
          if (!field) return undefined;
          const columnMeta = view?.columnMeta[field.id] ?? null;
          const width = columnMeta?.width || GRID_DEFAULT.columnWidth;
          const { id, type, name, description, isLookup, isPrimary, notNull } = field;
          const customTheme = getColumnThemeByField({
            field,
            theme,
            sortFieldIds,
            groupFieldIds,
            filterFieldIds,
          });

          return {
            id,
            name: notNull ? `${name} *` : name,
            width,
            description,
            customTheme,
            isPrimary,
            hasMenu,
            statisticLabel: {
              showAlways: i === 0,
              label: i === 0 ? t('common.summaryTip') : t('common.summary'),
            },
            icon: iconString(type, isLookup),
          };
        })
        .filter(Boolean)
        .filter((field) => {
          if (field) {
            return !view?.columnMeta?.[field?.id]?.hidden;
          }
          return false;
        }) as (IGridColumn & {
        id: string;
      })[];
    },
    [t]
  );
};

export const useCreateCellValue2GridDisplay = (rowHeight?: RowHeightLevel) => {
  const { t } = useTranslation();
  const i18nMap = useAttachmentPreviewI18Map();

  return useCallback(
    (fields: IFieldInstance[], editable: (field: IFieldInstance) => boolean) =>
      (
        record: Record,
        col: number,
        isPrefilling?: boolean,
        expandRecord?: (tableId: string, recordId: string) => void
        // eslint-disable-next-line sonarjs/cognitive-complexity
      ): ICell => {
        const field = fields[col];

        if (field == null) return { type: CellType.Loading };

        const {
          id: fieldId,
          type,
          isComputed,
          isMultipleCellValue: isMultiple,
          cellValueType,
        } = field;

        let cellValue = record.getCellValue(fieldId);
        const validateCellValue = field.validateCellValue(cellValue);
        cellValue = validateCellValue.success ? validateCellValue.data : undefined;
        const readonly = isComputed || (!editable(field) && !isPrefilling);
        const cellId = `${record.id}-${fieldId}`;
        const baseCellProps = { id: cellId, readonly };

        switch (type) {
          case FieldType.SingleLineText: {
            const { showAs } = field.options;

            if (showAs != null) {
              const { type } = showAs;

              return {
                ...baseCellProps,
                type: CellType.Link,
                data: cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [],
                displayData: field.cellValue2String(cellValue),
                onClick: (text) => onMixedTextClick(type, text),
              };
            }

            return {
              ...baseCellProps,
              type: CellType.Text,
              data: (cellValue as string) || '',
              displayData: field.cellValue2String(cellValue),
            };
          }
          case FieldType.LongText: {
            return {
              ...baseCellProps,
              type: CellType.Text,
              data: (cellValue as string) || '',
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
            if (type === FieldType.CreatedTime || type === FieldType.LastModifiedTime) {
              return {
                ...baseCellProps,
                type: CellType.Text,
                data: (cellValue as string) || '',
                displayData,
              };
            }
            return {
              ...baseCellProps,
              type: CellType.Text,
              data: (cellValue as string) || '',
              displayData,
              editorWidth: 250,
              customEditor: (props, editorRef) => (
                <GridDateEditor ref={editorRef} field={field} record={record} {...props} />
              ),
            };
          }
          case FieldType.AutoNumber: {
            return {
              ...baseCellProps,
              type: CellType.Number,
              data: cellValue as number,
              displayData: field.cellValue2String(cellValue),
            };
          }
          case FieldType.Number:
          case FieldType.Rollup:
          case FieldType.Formula: {
            if (cellValueType === CellValueType.Boolean) {
              return {
                ...baseCellProps,
                type: CellType.Boolean,
                data: (cellValue as boolean) || false,
                isMultiple,
              };
            }

            if (cellValueType === CellValueType.DateTime) {
              return {
                ...baseCellProps,
                type: CellType.Text,
                data: (cellValue as string) || '',
                displayData: field.cellValue2String(cellValue),
              };
            }

            if (cellValueType === CellValueType.String) {
              const showAs = field.options.showAs as ISingleLineTextShowAs;

              if (showAs != null) {
                const { type } = showAs;

                return {
                  ...baseCellProps,
                  type: CellType.Link,
                  data: cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [],
                  displayData: field.cellValue2String(cellValue),
                  onClick: (text) => onMixedTextClick(type, text),
                };
              }

              return {
                ...baseCellProps,
                type: CellType.Text,
                data: (cellValue as string) || '',
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
                ...baseCellProps,
                type: CellType.Chart,
                data: cellValue as number[],
                displayData: cellValue.map((v) => field.item2String(v)),
                chartType: showAs.type as unknown as ChartType,
                color: showAs.color,
              };
            }

            return {
              ...baseCellProps,
              type: CellType.Number,
              data: cellValue as number,
              displayData:
                isMultiple && Array.isArray(cellValue)
                  ? cellValue.map((v) => field.item2String(v))
                  : field.cellValue2String(cellValue),
              showAs: showAs as unknown as IGridNumberShowAs,
              customEditor: (props, editorRef) => (
                <GridNumberEditor
                  ref={editorRef}
                  field={field as NumberField}
                  record={record}
                  {...props}
                />
              ),
            };
          }
          case FieldType.MultipleSelect:
          case FieldType.SingleSelect: {
            const data = cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [];
            return {
              ...baseCellProps,
              type: CellType.Select,
              data,
              displayData: data,
              choiceSorted: field.options.choices,
              choiceMap: field.displayChoiceMap,
              isMultiple,
              editorWidth: 220,
              isEditingOnClick: true,
              customEditor: (props, editorRef) => (
                <GridSelectEditor ref={editorRef} field={field} record={record} {...props} />
              ),
            };
          }
          case FieldType.Link: {
            const cv = cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [];
            const displayData = cv.map(({ title }) => title || t('common.untitled'));
            const choices = cv.map(({ id, title }) => ({ id, name: title }));
            const { foreignTableId } = field.options;
            return {
              ...baseCellProps,
              type: CellType.Select,
              data: cv,
              displayData,
              choiceSorted: choices,
              isMultiple,
              onPreview: (activeId: string) => {
                expandRecord?.(foreignTableId, activeId);
              },
              customEditor: (props) => <GridLinkEditor field={field} record={record} {...props} />,
            };
          }
          case FieldType.Attachment: {
            const cv = (cellValue ?? []) as IAttachmentCellValue;
            const data = cv.map(
              ({ id, mimetype, presignedUrl, smThumbnailUrl, lgThumbnailUrl }) => {
                const url = getFileCover(mimetype, presignedUrl);
                const thumbnailUrl =
                  !rowHeight || rowHeight === RowHeightLevel.Short
                    ? smThumbnailUrl
                    : lgThumbnailUrl;
                return {
                  id,
                  url: isSystemFileIcon(mimetype) ? url : thumbnailUrl ?? url,
                };
              }
            );
            const displayData = data.map(({ url }) => url);
            return {
              ...baseCellProps,
              type: CellType.Image,
              data,
              displayData,
              onPreview: (activeId: string) => {
                expandPreviewModal({
                  activeId,
                  field,
                  record,
                  i18nMap,
                });
              },
              customEditor: (props) => (
                <GridAttachmentEditor field={field} record={record} {...props} />
              ),
            };
          }
          case FieldType.Checkbox: {
            return {
              ...baseCellProps,
              type: CellType.Boolean,
              data: (cellValue as boolean) || false,
              isMultiple,
            };
          }
          case FieldType.Rating: {
            const { icon, color, max } = field.options;

            if (isMultiple) {
              return {
                ...baseCellProps,
                type: CellType.Number,
                data: cellValue as number,
                displayData: field.cellValue2String(cellValue),
              };
            }

            return {
              ...baseCellProps,
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
              ...baseCellProps,
              type: CellType.User,
              data: data,
              editorWidth: 280,
              customEditor: (props, editorRef) => (
                <GridUserEditor ref={editorRef} field={field} record={record} {...props} />
              ),
            };
          }
          default: {
            return { type: CellType.Loading };
          }
        }
      },
    [i18nMap, rowHeight, t]
  );
};

export function useGridColumns(hasMenu?: boolean, hiddenFieldIds?: string[]) {
  const view = useView() as GridView | undefined;
  const originFields = useFields();
  const totalFields = useFields({ withHidden: true, withDenied: true });
  const fieldEditable = useFieldCellEditable();
  const { resolvedTheme } = useTheme();
  const sort = view?.sort;
  const group = view?.group;
  const filter = view?.filter;
  const isAutoSort = sort && !sort?.manualSort;

  const fields = useMemo(() => {
    const hiddenSet = new Set(hiddenFieldIds ?? []);
    return originFields.filter((field) => !hiddenSet.has(field.id));
  }, [originFields, hiddenFieldIds]);

  const sortFieldIds = useMemo(() => {
    if (!isAutoSort) return;

    return sort.sortObjs.reduce((prev, item) => {
      prev.add(item.fieldId);
      return prev;
    }, new Set<string>());
  }, [sort, isAutoSort]);

  const groupFieldIds = useMemo(() => {
    if (!group?.length) return;

    return group.reduce((prev, item) => {
      prev.add(item.fieldId);
      return prev;
    }, new Set<string>());
  }, [group]);

  const filterFieldIds = useMemo(() => {
    if (filter == null) return;
    return getFilterFieldIds(filter?.filterSet, keyBy(totalFields, 'id'));
  }, [filter, totalFields]);
  const createCellValue2GridDisplay = useCreateCellValue2GridDisplay(view?.options?.rowHeight);
  const generateColumns = useGenerateColumns();
  return useMemo(
    () => ({
      columns: generateColumns({
        fields,
        view,
        theme: resolvedTheme,
        hasMenu,
        sortFieldIds,
        groupFieldIds,
        filterFieldIds,
      }),
      cellValue2GridDisplay: createCellValue2GridDisplay(fields, fieldEditable),
    }),
    [
      fields,
      view,
      resolvedTheme,
      hasMenu,
      sortFieldIds,
      groupFieldIds,
      filterFieldIds,
      generateColumns,
      createCellValue2GridDisplay,
      fieldEditable,
    ]
  );
}
