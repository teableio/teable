import type {
  IAttachmentCellValue,
  IButtonFieldCellValue,
  IButtonFieldOptions,
  INumberShowAs,
  ISingleLineTextShowAs,
} from '@teable/core';
import {
  RowHeightLevel,
  CellValueType,
  ColorUtils,
  FieldType,
  checkButtonClickable,
} from '@teable/core';
import { useTheme } from '@teable/next-themes';
import { keyBy } from 'lodash';
import { LRUCache } from 'lru-cache';
import { useCallback, useMemo } from 'react';
import colors from 'tailwindcss/colors';
import type { ChartType, ICell, IGridColumn, INumberShowAs as IGridNumberShowAs } from '../..';
import { CellType, hexToRGBA, getFileCover, isSystemFileIcon, onMixedTextClick } from '../..';
import { useTranslation } from '../../../context/app/i18n/useTranslation';
import type { IButtonClickStatusHook } from '../../../hooks';
import { useFields, useTablePermission, useView } from '../../../hooks';
import type { IFieldInstance, NumberField, Record } from '../../../model';
import type { GridView } from '../../../model/view';
import { isMarkdownShowAs, stripMarkdown } from '../../editor/long-text/utils';
import { getFilterFieldIds } from '../../filter/view-filter/utils';
import type { IGridTheme } from '../../grid/configs';
import { GRID_DEFAULT } from '../../grid/configs';
import { useAttachmentPreviewI18Map } from '../../hooks';
import {
  GridAttachmentEditor,
  GridDateEditor,
  GridLinkEditor,
  GridMarkdownEditor,
  GridNumberEditor,
  GridSelectEditor,
  expandPreviewModal,
} from '../editor';
import { GridUserEditor } from '../editor/GridUserEditor';

const cellValueStringCache: LRUCache<string, string> = new LRUCache({ max: 1000 });

const iconString = (
  type: FieldType,
  isLookup: boolean | undefined,
  isConditionalLookup: boolean | undefined
) => {
  if (isLookup) {
    return isConditionalLookup ? `${type}_conditional_lookup` : `${type}_lookup`;
  }
  return type;
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
  const { rose, yellow } = colors;
  const isDark = theme === 'dark';
  const themeKey = isDark ? 'dark' : 'light';
  const opacity = isDark ? 1 : 0.8;

  // shades: [bg, bgSelected, bgHovered]
  const colorMap = {
    sort: {
      light: [colors.orange[50], colors.orange[100], colors.orange[200]] as const,
      dark: ['#251E14', '#2F2518', '#392C1B'] as const,
    },
    group: {
      light: [colors.emerald[50], colors.emerald[100], colors.emerald[200]] as const,
      dark: ['#0A261F', '#0C3026', '#0D3A2D'] as const,
    },
    filter: {
      light: [colors.violet[50], colors.violet[100], colors.violet[200]] as const,
      dark: ['#1D1527', '#241A31', '#322245'] as const,
    },
  };

  let customTheme: Partial<IGridTheme> | undefined = undefined;

  const conditionKey = filterFieldIds?.has(id)
    ? 'filter'
    : sortFieldIds?.has(id)
      ? 'sort'
      : groupFieldIds?.has(id)
        ? 'group'
        : null;

  if (conditionKey) {
    const [bg, bgSelected, bgHovered] = colorMap[conditionKey][themeKey];
    customTheme = {
      cellBg: hexToRGBA(bg, opacity),
      cellBgHovered: hexToRGBA(bgSelected, opacity),
      cellBgSelected: hexToRGBA(bgSelected, opacity),
      columnHeaderBg: hexToRGBA(bgSelected, opacity),
      columnHeaderBgHovered: hexToRGBA(bgHovered, opacity),
      columnHeaderBgSelected: hexToRGBA(bgHovered, opacity),
    };
  }

  if (hasError || isPending) {
    const c = hasError
      ? { light: [rose[100], rose[200]] as const, dark: [rose[500], rose[400]] as const }
      : { light: [yellow[100], yellow[200]] as const, dark: [yellow[500], yellow[400]] as const };
    const [h, hs] = c[themeKey];
    customTheme = {
      ...customTheme,
      columnHeaderBg: hexToRGBA(h, opacity),
      columnHeaderBgHovered: hexToRGBA(hs, opacity),
      columnHeaderBgSelected: hexToRGBA(hs, opacity),
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
            icon:
              field.aiConfig != null ? 'ai' : iconString(type, isLookup, field.isConditionalLookup),
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

export const useCreateCellValue2GridDisplay = (
  rowHeight?: RowHeightLevel,
  recordEditable?: boolean
) => {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const i18nMap = useAttachmentPreviewI18Map();

  return useCallback(
    (fields: IFieldInstance[]) =>
      (
        record: Record,
        col: number,
        isPrefilling?: boolean,
        expandRecord?: (tableId: string, recordId: string) => void,
        buttonClickStatusHook?: IButtonClickStatusHook
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
        const recordReadOnly = !recordEditable && !isPrefilling;
        const fieldLocked = record.isLocked(fieldId) && !isPrefilling;
        const readonly = isComputed || recordReadOnly || fieldLocked;
        const cellId = `${record.id}-${fieldId}`;
        const baseCellProps = { id: cellId, readonly, locked: fieldLocked };
        const isHidden = record.isHidden(fieldId);
        if (isHidden) {
          return {
            ...baseCellProps,
            type: CellType.Text,
            data: '',
            displayData: '',
            hidden: true,
          };
        }

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
            const rawDisplayData = field.cellValue2String(cellValue);
            const isMarkdown = isMarkdownShowAs(field.options);
            const isLookupField = Boolean(field.isLookup);
            return {
              ...baseCellProps,
              type: CellType.Text,
              data: (cellValue as string) || '',
              displayData: isMarkdown ? stripMarkdown(rawDisplayData) : rawDisplayData,
              isWrap: true,
              readonly: readonly || isLookupField,
              readonlyCustomEditor: isLookupField,
              customEditor: (props, editorRef) => (
                <GridMarkdownEditor
                  ref={editorRef}
                  field={field}
                  record={record}
                  readonlyExpandable={Boolean(field.isLookup)}
                  {...props}
                />
              ),
            };
          }
          case FieldType.Date:
          case FieldType.CreatedTime:
          case FieldType.LastModifiedTime: {
            let displayData = '';
            const formatting = field.getDatetimeFormatting();
            const date = formatting.date;
            const time = formatting.time;
            const timeZone = formatting.timeZone;
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
          case FieldType.Formula:
          case FieldType.ConditionalRollup: {
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
              showAddButton: !readonly,
              onPreview: (activeId: string) => {
                expandRecord?.(foreignTableId, activeId);
              },
              customEditor: (props) => <GridLinkEditor field={field} record={record} {...props} />,
            };
          }
          case FieldType.Attachment: {
            const cv = (cellValue ?? []) as IAttachmentCellValue;
            const data = cv.map(
              ({ id, mimetype, presignedUrl, smThumbnailUrl, lgThumbnailUrl, width, height }) => {
                const url = getFileCover(mimetype, presignedUrl, resolvedTheme as 'light' | 'dark');
                const thumbnailUrl =
                  !rowHeight || rowHeight === RowHeightLevel.Short
                    ? smThumbnailUrl
                    : lgThumbnailUrl;
                return {
                  id,
                  url: isSystemFileIcon(mimetype) ? url : thumbnailUrl ?? url,
                  width,
                  height,
                };
              }
            );
            const displayData = data.map(({ url }) => url);
            return {
              ...baseCellProps,
              type: CellType.Image,
              data,
              displayData,
              editorWidth: 462,
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
                avatarUrl,
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
          case FieldType.Button: {
            return {
              ...baseCellProps,
              readonly:
                // readonly ||
                !checkButtonClickable(
                  field.options as IButtonFieldOptions,
                  cellValue as IButtonFieldCellValue
                ),
              type: CellType.Button,
              data: {
                tableId: field.tableId,
                cellValue: cellValue as IButtonFieldCellValue,
                fieldOptions: field.options,
                statusHook: buttonClickStatusHook,
                record,
              },
            };
          }
          default: {
            return { type: CellType.Loading };
          }
        }
      },
    [i18nMap, recordEditable, resolvedTheme, rowHeight, t]
  );
};

export function useGridColumns(hasMenu?: boolean, hiddenFieldIds?: string[]) {
  const view = useView() as GridView | undefined;
  const originFields = useFields();
  const totalFields = useFields({ withHidden: true, withDenied: true });
  const { resolvedTheme } = useTheme();
  const sort = view?.sort;
  const group = view?.group;
  const filter = view?.filter;
  const isAutoSort = sort && !sort?.manualSort;
  const permission = useTablePermission();

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
  const createCellValue2GridDisplay = useCreateCellValue2GridDisplay(
    view?.options?.rowHeight,
    permission['record|update']
  );
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
      cellValue2GridDisplay: createCellValue2GridDisplay(fields),
    }),
    [
      generateColumns,
      fields,
      view,
      resolvedTheme,
      hasMenu,
      sortFieldIds,
      groupFieldIds,
      filterFieldIds,
      createCellValue2GridDisplay,
    ]
  );
}
