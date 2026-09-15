import type { IFilter, IFilterItem, IGridRowColorRule, ISelectFieldChoice } from '@teable/core';
import { Colors, ColorUtils, DateUtil } from '@teable/core';
import type { IFieldInstance } from '@teable/sdk/model';

const ROW_COLOR_SOURCE_BY_PREFIX: Array<[string, Colors]> = [
  ['blue', Colors.BlueBright],
  ['cyan', Colors.CyanBright],
  ['gray', Colors.GrayBright],
  ['green', Colors.GreenBright],
  ['orange', Colors.OrangeBright],
  ['pink', Colors.PinkBright],
  ['purple', Colors.PurpleBright],
  ['red', Colors.RedBright],
  ['teal', Colors.TealBright],
  ['yellow', Colors.YellowBright],
];

const hexToRgb = (hex: string) => {
  const rawValue = hex.replace('#', '');
  const value =
    rawValue.length === 3
      ? rawValue
          .split('')
          .map((item) => item.repeat(2))
          .join('')
      : rawValue;
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const mixHexColors = (foreground: string, background: string, foregroundWeight: number) => {
  const foregroundRgb = hexToRgb(foreground);
  const backgroundRgb = hexToRgb(background);
  if (!foregroundRgb || !backgroundRgb) return background;

  const channel = (foregroundValue: number, backgroundValue: number) =>
    Math.round(foregroundValue * foregroundWeight + backgroundValue * (1 - foregroundWeight));
  const value = [
    channel(foregroundRgb.r, backgroundRgb.r),
    channel(foregroundRgb.g, backgroundRgb.g),
    channel(foregroundRgb.b, backgroundRgb.b),
  ]
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');

  return `#${value.toUpperCase()}`;
};

export const getChoiceRowTint = (
  choiceColor: string,
  backgroundColor: string,
  themeKey: string
) => {
  const normalizedColor = ROW_COLOR_SOURCE_BY_PREFIX.find(([prefix]) =>
    choiceColor.toLowerCase().startsWith(prefix)
  )?.[1];
  const sourceColor = ColorUtils.getHexForColor(normalizedColor ?? choiceColor);
  if (!sourceColor) return undefined;

  return mixHexColors(sourceColor, backgroundColor, themeKey === 'dark' ? 0.24 : 0.12);
};

export const getFirstMatchedChoiceColor = (
  cellValue: unknown,
  choices: ISelectFieldChoice[],
  enabledChoiceIds?: string[]
) => {
  const choiceByName = new Map(choices.map((choice) => [choice.name, choice]));
  const enabledChoiceIdSet = enabledChoiceIds ? new Set(enabledChoiceIds) : undefined;
  const values = Array.isArray(cellValue) ? cellValue : [cellValue];
  const choice = values
    .map((value) => (typeof value === 'string' ? choiceByName.get(value) : undefined))
    .find((item) => item && (!enabledChoiceIdSet || enabledChoiceIdSet.has(item.id)));

  return choice?.color;
};

const isEmptyValue = (value: unknown) =>
  value == null || value === '' || (Array.isArray(value) && value.length === 0);

const normalizeComparableValue = (value: unknown): string | number | boolean | null => {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value ?? null;
  }
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    const identity = item.id ?? item.value ?? item.name ?? item.title;
    if (
      typeof identity === 'string' ||
      typeof identity === 'number' ||
      typeof identity === 'boolean'
    ) {
      return identity;
    }
  }
  return String(value);
};

const normalizeComparableList = (value: unknown) =>
  (Array.isArray(value) ? value : [value])
    .map(normalizeComparableValue)
    .filter((item) => item != null);

const equalsValue = (left: unknown, right: unknown) => {
  const normalizedLeft = normalizeComparableValue(left);
  const normalizedRight = normalizeComparableValue(right);
  return typeof normalizedLeft === 'string' && typeof normalizedRight === 'string'
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
};

const getMondayWeekRange = (dateUtil: DateUtil, cursor = dateUtil.date()) => {
  const daysSinceMonday = (cursor.day() + 6) % 7;
  const start = cursor.subtract(daysSinceMonday, 'day').startOf('day');
  return [start, start.add(6, 'day').endOf('day')] as const;
};

const getDateRange = (value: Exclude<IFilterItem['value'], null> & { mode?: string }) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('mode' in value)) return;
  const dateValue = value as {
    mode: string;
    numberOfDays?: number;
    exactDate?: string;
    exactDateEnd?: string;
    timeZone?: string;
  };
  const dateUtil = new DateUtil(dateValue.timeZone ?? 'UTC');
  const now = dateUtil.date();
  const dayRange = (cursor: ReturnType<DateUtil['date']>) =>
    [cursor.startOf('day'), cursor.endOf('day')] as const;
  const periodRange = (cursor: ReturnType<DateUtil['date']>, unit: 'month' | 'year') =>
    [cursor.startOf(unit).startOf('day'), cursor.endOf(unit).endOf('day')] as const;
  const offsetRange = (amount: number, unit: 'day' | 'week' | 'month' | 'year', future: boolean) =>
    future
      ? ([now.startOf('day'), now.add(amount, unit).endOf('day')] as const)
      : ([now.subtract(amount, unit).startOf('day'), now.endOf('day')] as const);

  const range = (() => {
    switch (dateValue.mode) {
      case 'today':
        return dayRange(now);
      case 'tomorrow':
        return dayRange(now.add(1, 'day'));
      case 'yesterday':
        return dayRange(now.subtract(1, 'day'));
      case 'oneWeekAgo':
        return dayRange(now.subtract(1, 'week'));
      case 'oneWeekFromNow':
        return dayRange(now.add(1, 'week'));
      case 'oneMonthAgo':
        return dayRange(now.subtract(1, 'month'));
      case 'oneMonthFromNow':
        return dayRange(now.add(1, 'month'));
      case 'daysAgo':
        return dayRange(now.subtract(dateValue.numberOfDays ?? 0, 'day'));
      case 'daysFromNow':
        return dayRange(now.add(dateValue.numberOfDays ?? 0, 'day'));
      case 'currentWeek':
        return getMondayWeekRange(dateUtil, now);
      case 'lastWeek':
        return getMondayWeekRange(dateUtil, now.subtract(1, 'week'));
      case 'nextWeekPeriod':
        return getMondayWeekRange(dateUtil, now.add(1, 'week'));
      case 'currentMonth':
        return periodRange(now, 'month');
      case 'lastMonth':
        return periodRange(now.subtract(1, 'month'), 'month');
      case 'nextMonthPeriod':
        return periodRange(now.add(1, 'month'), 'month');
      case 'currentYear':
        return periodRange(now, 'year');
      case 'lastYear':
        return periodRange(now.subtract(1, 'year'), 'year');
      case 'nextYearPeriod':
        return periodRange(now.add(1, 'year'), 'year');
      case 'pastWeek':
        return offsetRange(1, 'week', false);
      case 'pastMonth':
        return offsetRange(1, 'month', false);
      case 'pastYear':
        return offsetRange(1, 'year', false);
      case 'nextWeek':
        return offsetRange(1, 'week', true);
      case 'nextMonth':
        return offsetRange(1, 'month', true);
      case 'nextYear':
        return offsetRange(1, 'year', true);
      case 'pastNumberOfDays':
        return offsetRange(dateValue.numberOfDays ?? 0, 'day', false);
      case 'nextNumberOfDays':
        return offsetRange(dateValue.numberOfDays ?? 0, 'day', true);
      case 'dateRange':
        if (!dateValue.exactDate || !dateValue.exactDateEnd) return;
        return [dateUtil.date(dateValue.exactDate), dateUtil.date(dateValue.exactDateEnd)] as const;
      case 'exactDate':
      case 'exactFormatDate':
        return dateValue.exactDate ? dayRange(dateUtil.date(dateValue.exactDate)) : undefined;
      default:
        return;
    }
  })();
  return range ? ([range[0].valueOf(), range[1].valueOf()] as const) : undefined;
};

// Operators deliberately stay centralized so rule evaluation keeps the same priority semantics.
/* eslint-disable sonarjs/cognitive-complexity */
const matchesFilterItem = (
  item: IFilterItem,
  getCellValue: (fieldId: string) => unknown,
  fieldMap: Map<string, IFieldInstance>
) => {
  const cellValue = getCellValue(item.fieldId);
  const field = fieldMap.get(item.fieldId);
  const { operator, value } = item;
  if (operator === 'isEmpty') return isEmptyValue(cellValue);
  if (operator === 'isNotEmpty') return !isEmptyValue(cellValue);

  const dateRange =
    value && typeof value === 'object' && !Array.isArray(value)
      ? getDateRange(value as Exclude<IFilterItem['value'], null> & { mode?: string })
      : undefined;
  if (dateRange) {
    const timestamp = Date.parse(String(Array.isArray(cellValue) ? cellValue[0] : cellValue));
    if (!Number.isFinite(timestamp)) return false;
    const [start, end] = dateRange;
    if (operator === 'is' || operator === 'isWithIn') return timestamp >= start && timestamp <= end;
    if (operator === 'isNot') return timestamp < start || timestamp > end;
    if (operator === 'isBefore') return timestamp < start;
    if (operator === 'isAfter') return timestamp > end;
    if (operator === 'isOnOrBefore') return timestamp <= end;
    if (operator === 'isOnOrAfter') return timestamp >= start;
  }

  const currentValues = normalizeComparableList(cellValue);
  const targetValues = normalizeComparableList(value);
  const hasTarget = (current: unknown) =>
    targetValues.some((target) => equalsValue(current, target));
  const anyMatch = currentValues.some(hasTarget);
  const allMatch = targetValues.every((target) =>
    currentValues.some((current) => equalsValue(current, target))
  );

  switch (operator) {
    case 'is':
      return equalsValue(cellValue, value);
    case 'isNot':
      return !equalsValue(cellValue, value);
    case 'contains':
      return (field?.cellValue2String(cellValue) ?? String(cellValue ?? ''))
        .toLocaleLowerCase()
        .includes(String(value ?? '').toLocaleLowerCase());
    case 'doesNotContain':
      return !(field?.cellValue2String(cellValue) ?? String(cellValue ?? ''))
        .toLocaleLowerCase()
        .includes(String(value ?? '').toLocaleLowerCase());
    case 'isGreater':
      return Number(cellValue) > Number(value);
    case 'isGreaterEqual':
      return Number(cellValue) >= Number(value);
    case 'isLess':
      return Number(cellValue) < Number(value);
    case 'isLessEqual':
      return Number(cellValue) <= Number(value);
    case 'isAnyOf':
    case 'hasAnyOf':
      return anyMatch;
    case 'isNoneOf':
    case 'hasNoneOf':
      return !anyMatch;
    case 'hasAllOf':
      return allMatch;
    case 'isExactly':
      return allMatch && currentValues.length === targetValues.length;
    case 'isNotExactly':
      return !(allMatch && currentValues.length === targetValues.length);
    default:
      return false;
  }
};
/* eslint-enable sonarjs/cognitive-complexity */

export const matchesRowColorFilter = (
  filter: IFilter,
  getCellValue: (fieldId: string) => unknown,
  fields: IFieldInstance[]
): boolean => {
  if (!filter?.filterSet.length) return false;
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  const matchesNode = (node: NonNullable<IFilter> | IFilterItem): boolean => {
    if ('filterSet' in node) {
      if (!node.filterSet.length) return false;
      const results = node.filterSet.map(matchesNode);
      return node.conjunction === 'or' ? results.some(Boolean) : results.every(Boolean);
    }
    return matchesFilterItem(node, getCellValue, fieldMap);
  };
  return matchesNode(filter);
};

export const getFirstMatchedRuleColor = (
  rules: IGridRowColorRule[] | undefined,
  getCellValue: (fieldId: string) => unknown,
  fields: IFieldInstance[]
) =>
  rules?.find(
    (rule) => rule.enabled !== false && matchesRowColorFilter(rule.filter, getCellValue, fields)
  )?.color;

export const getRowColorRuleFieldIds = (rules: IGridRowColorRule[] | undefined) => {
  const ids = new Set<string>();
  const visit = (filter: IFilter) =>
    filter?.filterSet.forEach((item) => {
      if ('filterSet' in item) visit(item);
      else ids.add(item.fieldId);
    });
  rules?.forEach((rule) => visit(rule.filter));
  return ids;
};
