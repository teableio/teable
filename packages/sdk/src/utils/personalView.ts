import type {
  IGalleryViewOptions,
  IFieldVo,
  IViewVo,
  IKanbanViewOptions,
  ICalendarViewOptions,
  IColumnMeta,
  IFilter,
  IFilterItem,
  IFilterSet,
  ISelectFieldOptions,
  IOperator,
  ISortItem,
} from '@teable/core';
import {
  assertNever,
  CellValueType,
  ColorConfigType,
  FieldType,
  filterSchema,
  getValidFilterOperators,
  isFieldReferenceValue,
  ViewType,
} from '@teable/core';
import { keyBy } from 'lodash';
import type { GridView, KanbanView, GalleryView, CalendarView, FormView } from '../model';
import type { PluginView } from '../model/view/plugin.view';
import { removePinyinSortGroupConflicts, supportsPinyinSort } from './sort';

export const validatePersonalViewSortCollations = (view: IViewVo, fields: IFieldVo[]) => {
  const sort = removePinyinSortGroupConflicts(view.sort, view.group);
  if (!sort) return sort === view.sort ? view : { ...view, sort };

  const fieldMap = keyBy(fields, 'id');
  let changed = sort !== view.sort;
  const sortObjs = sort.sortObjs.map((sortItem) => {
    const field = fieldMap[sortItem.fieldId];
    if (sortItem.collation !== 'zh-pinyin' || !field || supportsPinyinSort(field)) {
      return sortItem;
    }
    changed = true;
    const { collation: _collation, ...sortWithoutCollation } = sortItem;
    return sortWithoutCollation;
  });

  return changed ? { ...view, sort: { ...sort, sortObjs } } : view;
};

// eslint-disable-next-line sonarjs/cognitive-complexity
export const validatePersonalViewProps = (view: IViewVo, fields: IFieldVo[]) => {
  const { filter, sort, group, options, columnMeta } = view;
  const fieldMap = keyBy(fields, 'id');
  const willSyncViewData: IViewVo = { ...view };

  if (filter) {
    willSyncViewData.filter = validateViewFilter(filter, fieldMap);
  }

  const groupSafeSort = removePinyinSortGroupConflicts(sort, group);
  if (groupSafeSort) {
    const sortObjs = groupSafeSort.sortObjs?.reduce<ISortItem[]>((validSorts, sortItem) => {
      const field = fieldMap[sortItem.fieldId];
      if (!field) return validSorts;

      if (sortItem.collation === 'zh-pinyin' && !supportsPinyinSort(field)) {
        const { collation: _collation, ...sortWithoutCollation } = sortItem;
        validSorts.push(sortWithoutCollation);
      } else {
        validSorts.push(sortItem);
      }
      return validSorts;
    }, []);
    willSyncViewData.sort = sortObjs?.length
      ? {
          ...groupSafeSort,
          sortObjs,
        }
      : undefined;
  }

  if (group) {
    const filteredGroup = group?.filter((g) => fieldMap[g.fieldId]);
    willSyncViewData.group = filteredGroup?.length ? filteredGroup : undefined;
  }

  if (options) {
    willSyncViewData.options = validateViewOptions(view, fieldMap);
  }

  if (columnMeta) {
    willSyncViewData.columnMeta = Object.entries(columnMeta).reduce((acc, [fieldId, column]) => {
      if (fieldMap[fieldId]) {
        acc[fieldId] = column;
      }
      return acc;
    }, {} as IColumnMeta);
  }

  return willSyncViewData;
};

const validateSelectFilterValue = (
  item: IFilterItem,
  choices: ISelectFieldOptions['choices'],
  expectsArray: boolean
): IFilterItem | null => {
  const { value } = item;
  if (expectsArray) {
    if (!Array.isArray(value)) return null;
    const validChoices = choices.filter((choice) => value.includes(choice.name));
    return validChoices.length
      ? ({ ...item, value: validChoices.map((choice) => choice.name) } as IFilterItem)
      : null;
  }
  if (typeof value !== 'string') return null;
  return choices.some((choice) => choice.name === value) ? item : null;
};

export const validateFilterItem = (item: IFilterItem, fieldMap: Record<string, IFieldVo>) => {
  const { fieldId, value, operator } = item;
  const field = fieldMap[fieldId];

  if (!field) return null;

  if (item.isSymbol) return item;

  const { type, options, isMultipleCellValue } = field;
  const validOperators = getValidFilterOperators(field);

  if (!validOperators.includes(operator as IOperator)) return null;

  if (isFieldReferenceValue(value)) return item;

  if (value == null) {
    return item;
  }

  if (type === FieldType.SingleSelect && !isMultipleCellValue) {
    return validateSelectFilterValue(
      item,
      (options as ISelectFieldOptions).choices,
      operator === 'isAnyOf' || operator === 'isNoneOf'
    );
  }
  if ([FieldType.MultipleSelect, FieldType.SingleSelect].includes(type) && isMultipleCellValue) {
    return validateSelectFilterValue(item, (options as ISelectFieldOptions).choices, true);
  }
  return item;
};

export const validateViewFilter = (filter: IFilter, fieldMap: Record<string, IFieldVo>) => {
  if (!filter) return;

  const result = filterSchema.safeParse(filter);
  if (!result.success || result.data == null) return;

  const validateFilter = (item: IFilterItem | IFilterSet): IFilterItem | IFilterSet | null => {
    if ('fieldId' in item) {
      return validateFilterItem(item, fieldMap);
    }

    if ('filterSet' in item) {
      const validFilters = item.filterSet
        .map((subItem) => validateFilter(subItem))
        .filter((item) => item !== null);

      if (validFilters.length === 0) return null;

      return {
        conjunction: item.conjunction,
        filterSet: validFilters as (IFilterItem | IFilterSet)[],
      };
    }

    return null;
  };

  const validatedFilter = validateFilter(result.data);
  return validatedFilter as IFilter;
};

export const validateViewOptions = (view: IViewVo, fieldMap: Record<string, IFieldVo>) => {
  const { type, options } = view;

  switch (type) {
    case ViewType.Grid:
    case ViewType.Form: {
      return options;
    }
    case ViewType.Gallery: {
      const { coverFieldId } = options as IGalleryViewOptions;
      return {
        ...options,
        coverFieldId: validateField(coverFieldId, fieldMap, FieldType.Attachment),
      };
    }
    case ViewType.Kanban: {
      const { stackFieldId, coverFieldId } = options as IKanbanViewOptions;

      return {
        ...options,
        stackFieldId: validateField(stackFieldId, fieldMap),
        coverFieldId: validateField(coverFieldId, fieldMap, FieldType.Attachment),
      };
    }
    case ViewType.Calendar: {
      const { startDateFieldId, endDateFieldId, titleFieldId, colorConfig } =
        options as ICalendarViewOptions;
      const isColorByField = colorConfig?.type === ColorConfigType.Field;
      const colorFieldId = isColorByField ? colorConfig?.fieldId : null;
      const colorField = colorFieldId ? fieldMap[colorFieldId] : null;

      return {
        ...options,
        startDateFieldId: validateCalendarDateField(startDateFieldId, fieldMap),
        endDateFieldId: validateCalendarDateField(endDateFieldId, fieldMap),
        titleFieldId: validateField(titleFieldId, fieldMap),
        colorConfig: isColorByField
          ? colorFieldId && colorField && colorField.type === FieldType.SingleSelect
            ? {
                ...colorConfig,
                fieldId: colorFieldId,
              }
            : undefined
          : colorConfig,
      };
    }
    default: {
      assertNever(type as never);
    }
  }
};

const validateField = (
  fieldId: string | null | undefined,
  fieldMap: Record<string, IFieldVo>,
  expectedType?: FieldType
) => {
  if (!fieldId) return;
  const field = fieldMap[fieldId];
  if (!field) return;
  if (expectedType && field.type !== expectedType) return;
  return fieldId;
};

const validateCalendarDateField = (
  fieldId: string | null | undefined,
  fieldMap: Record<string, IFieldVo>
) => {
  if (!fieldId) return;
  const field = fieldMap[fieldId];
  if (field?.cellValueType !== CellValueType.DateTime || field.isMultipleCellValue) return;
  return fieldId;
};

export const generatePersonalViewProps = (
  view: GridView | KanbanView | GalleryView | CalendarView | FormView | PluginView | undefined
) => {
  if (!view || view.type === ViewType.Plugin || view.type === ViewType.Form) return {};

  const { id, type, filter, sort, group, options, columnMeta } = view;

  return {
    id,
    type,
    filter,
    sort,
    group,
    options,
    columnMeta,
  };
};
