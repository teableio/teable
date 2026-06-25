import type {
  IDateTimeFieldOperator,
  IFilter,
  IFilterItem,
  IFilterSet,
  IGroup,
  IOperator,
  ISort,
  ISortItem,
} from '@teable/core';
import {
  CellValueType,
  FieldType,
  getValidFilterOperators,
  getValidFilterSubOperators,
  RowHeightLevel,
  SortFunc,
  ViewType,
} from '@teable/core';
import type { IImportAirtableIssue } from '@teable/openapi';
import type {
  IAirtableFilterGroup,
  IAirtableFilterLeaf,
  IAirtableViewConfig,
} from './airtable-share.client';

/** The Teable field a mapped view references, with what filtering needs. */
export interface IImportFieldMeta {
  fieldId: string;
  type: FieldType;
  cellValueType: CellValueType;
  isMultipleCellValue: boolean;
}

export interface IViewConfigMapperContext {
  /** airtable columnId (a field id) -> imported Teable field, or undefined. */
  resolveField: (columnId: string) => IImportFieldMeta | undefined;
  /** airtable select option id -> its name (Teable filters select by name). */
  resolveSelectOptionName: (columnId: string, optionId: string) => string | undefined;
}

export interface IMappedViewConfig {
  filter?: IFilter;
  sort?: ISort;
  group?: IGroup;
  options?: Record<string, unknown>;
}

/** Airtable date-filter mode -> Teable date sub-operator (mode). */
const dateModeMap: Record<string, string> = {
  today: 'today',
  tomorrow: 'tomorrow',
  yesterday: 'yesterday',
  exactDate: 'exactDate',
  daysAgo: 'daysAgo',
  daysFromNow: 'daysFromNow',
  oneWeekAgo: 'oneWeekAgo',
  oneWeekFromNow: 'oneWeekFromNow',
  oneMonthAgo: 'oneMonthAgo',
  oneMonthFromNow: 'oneMonthFromNow',
  pastWeek: 'pastWeek',
  pastMonth: 'pastMonth',
  pastYear: 'pastYear',
  nextWeek: 'nextWeek',
  nextMonth: 'nextMonth',
  nextYear: 'nextYear',
  pastNumberOfDays: 'pastNumberOfDays',
  nextNumberOfDays: 'nextNumberOfDays',
  thisCalendarWeek: 'currentWeek',
  thisCalendarMonth: 'currentMonth',
  thisCalendarYear: 'currentYear',
};

/** Airtable rowHeight -> Teable RowHeightLevel; unknown -> undefined (degrade). */
const rowHeightMap: Record<string, RowHeightLevel> = {
  short: RowHeightLevel.Short,
  medium: RowHeightLevel.Medium,
  tall: RowHeightLevel.Tall,
  extraTall: RowHeightLevel.ExtraTall,
  // legacy alias seen in other importers
  xlarge: RowHeightLevel.ExtraTall,
};

const isSelectField = (meta: IImportFieldMeta) =>
  meta.type === FieldType.SingleSelect || meta.type === FieldType.MultipleSelect;

const isMultiValued = (meta: IImportFieldMeta) =>
  meta.isMultipleCellValue === true || meta.type === FieldType.MultipleSelect;

/**
 * Fields whose Airtable filter value references specific records/collaborators
 * (link, user, ...). Those ids cannot be remapped reliably at view-config time,
 * so value-based conditions on them are dropped (empty/not-empty still apply).
 */
const isRecordReferenceField = (meta: IImportFieldMeta) =>
  meta.type === FieldType.Link ||
  meta.type === FieldType.User ||
  meta.type === FieldType.CreatedBy ||
  meta.type === FieldType.LastModifiedBy;

// Operator dispatch: branchy by nature (field type x Airtable operator).
// eslint-disable-next-line sonarjs/cognitive-complexity
const mapOperator = (airtableOperator: string, meta: IImportFieldMeta): IOperator | undefined => {
  if (airtableOperator === 'isEmpty') return 'isEmpty';
  if (airtableOperator === 'isNotEmpty') return 'isNotEmpty';

  const isDate = meta.cellValueType === CellValueType.DateTime;
  const multi = isMultiValued(meta);

  switch (airtableOperator) {
    case '=':
      if (isDate) return 'is';
      return multi ? 'isExactly' : 'is';
    case '!=':
      if (isDate) return 'isNot';
      return multi ? 'isNotExactly' : 'isNot';
    case '<':
      return isDate ? 'isBefore' : 'isLess';
    case '<=':
      return isDate ? 'isOnOrBefore' : 'isLessEqual';
    case '>':
      return isDate ? 'isAfter' : 'isGreater';
    case '>=':
      return isDate ? 'isOnOrAfter' : 'isGreaterEqual';
    case 'contains':
      return 'contains';
    case 'doesNotContain':
      return 'doesNotContain';
    case 'isWithin':
      return 'isWithIn';
    case 'isAnyOf':
    case '|':
      return multi ? 'hasAnyOf' : 'isAnyOf';
    case 'isNoneOf':
      return multi ? 'hasNoneOf' : 'isNoneOf';
    case '&':
      return multi ? 'hasAllOf' : 'isAnyOf';
    default:
      // filename, filetype, and any unknown operator
      return undefined;
  }
};

const needsNoValue = (operator: IOperator) => operator === 'isEmpty' || operator === 'isNotEmpty';

/** Maps Airtable select option id(s) to the option name(s) Teable filters by. */
const mapSelectFilterValue = (
  leaf: IAirtableFilterLeaf,
  operator: IOperator,
  meta: IImportFieldMeta,
  ctx: IViewConfigMapperContext
): { value: IFilterItem['value'] } | undefined => {
  const ids = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
  const names = ids
    .map((id) =>
      typeof id === 'string' ? ctx.resolveSelectOptionName(leaf.columnId, id) : undefined
    )
    .filter((name): name is string => name != null);
  if (names.length === 0) return undefined;
  const multi = isMultiValued(meta) || operator === 'isAnyOf' || operator === 'isNoneOf';
  return { value: multi ? names : names[0] };
};

/** Maps a scalar (number/boolean/text) Airtable filter value to Teable's. */
const mapScalarFilterValue = (
  value: unknown,
  cellValueType: CellValueType
): { value: IFilterItem['value'] } | undefined => {
  if (cellValueType === CellValueType.Boolean) {
    return { value: value === true || value === 'true' };
  }
  if (cellValueType === CellValueType.Number) {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? { value: num } : undefined;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return { value: String(value) };
  }
  return undefined;
};

/** Drops a clause (returns undefined) or yields the mapped Teable value. */
const mapFilterValue = (
  leaf: IAirtableFilterLeaf,
  operator: IOperator,
  meta: IImportFieldMeta,
  ctx: IViewConfigMapperContext
): { value: IFilterItem['value'] } | undefined => {
  if (needsNoValue(operator)) return { value: null };
  // Conditions that point at specific linked records/collaborators can't be
  // remapped to the new ids here; keep the import honest by dropping them.
  if (isRecordReferenceField(meta)) return undefined;
  if (isSelectField(meta)) return mapSelectFilterValue(leaf, operator, meta, ctx);
  if (meta.cellValueType === CellValueType.DateTime) {
    return mapDateValue(leaf.value, operator, meta);
  }
  return mapScalarFilterValue(leaf.value, meta.cellValueType);
};

const mapDateValue = (
  rawValue: unknown,
  operator: IOperator,
  meta: IImportFieldMeta
): { value: IFilterItem['value'] } | undefined => {
  if (!rawValue || typeof rawValue !== 'object') return undefined;
  const source = rawValue as { mode?: string; numberOfDays?: number; exactDate?: string };
  const teableMode = source.mode ? dateModeMap[source.mode] : undefined;
  if (!teableMode) return undefined;

  const validModes = getValidFilterSubOperators(meta.type, operator as IDateTimeFieldOperator);
  if (!validModes || !validModes.includes(teableMode as never)) return undefined;

  const value: Record<string, unknown> = { mode: teableMode, timeZone: 'UTC' };
  if (source.numberOfDays != null) value.numberOfDays = source.numberOfDays;
  if (source.exactDate != null) value.exactDate = source.exactDate;
  return { value: value as IFilterItem['value'] };
};

const mapFilterLeaf = (
  leaf: IAirtableFilterLeaf,
  ctx: IViewConfigMapperContext,
  onDrop: (reason: string) => void
): IFilterItem | undefined => {
  const meta = ctx.resolveField(leaf.columnId);
  if (!meta) {
    onDrop('a filter field was not imported');
    return undefined;
  }
  const operator = mapOperator(leaf.operator, meta);
  if (!operator || !getValidFilterOperators(meta).includes(operator)) {
    onDrop(`operator "${leaf.operator}" is not supported on this field`);
    return undefined;
  }
  const mapped = mapFilterValue(leaf, operator, meta, ctx);
  if (!mapped) {
    onDrop(`a "${leaf.operator}" condition could not be converted`);
    return undefined;
  }
  return { fieldId: meta.fieldId, operator, value: mapped.value };
};

const isFilterGroup = (
  node: IAirtableFilterLeaf | IAirtableFilterGroup
): node is IAirtableFilterGroup =>
  (node as IAirtableFilterGroup).filterSet !== undefined &&
  (node as IAirtableFilterGroup).conjunction !== undefined;

const mapFilterNode = (
  node: IAirtableFilterGroup,
  ctx: IViewConfigMapperContext,
  onDrop: (reason: string) => void
): IFilterSet | undefined => {
  const filterSet: Array<IFilterItem | IFilterSet> = [];
  for (const child of node.filterSet ?? []) {
    if (isFilterGroup(child)) {
      const nested = mapFilterNode(child, ctx, onDrop);
      if (nested && nested.filterSet.length > 0) filterSet.push(nested);
    } else {
      const leaf = mapFilterLeaf(child, ctx, onDrop);
      if (leaf) filterSet.push(leaf);
    }
  }
  if (filterSet.length === 0) return undefined;
  return { conjunction: node.conjunction === 'or' ? 'or' : 'and', filterSet };
};

/**
 * Maps an Airtable filter group to a Teable filter. Shared by view-config import
 * and rollup record-selection ("only include linked records that meet conditions").
 */
export const mapAirtableFilter = (
  filter: IAirtableFilterGroup,
  ctx: IViewConfigMapperContext,
  onDrop: (reason: string) => void = () => undefined
): IFilter | undefined => mapFilterNode(filter, ctx, onDrop);

const mapSorts = (
  config: IAirtableViewConfig,
  ctx: IViewConfigMapperContext
): ISort | undefined => {
  const sortObjs: ISortItem[] = [];
  for (const sort of config.sorts ?? []) {
    const meta = ctx.resolveField(sort.columnId);
    if (!meta) continue;
    sortObjs.push({ fieldId: meta.fieldId, order: sort.ascending ? SortFunc.Asc : SortFunc.Desc });
  }
  return sortObjs.length > 0 ? { sortObjs, manualSort: false } : undefined;
};

const mapGroups = (
  config: IAirtableViewConfig,
  ctx: IViewConfigMapperContext
): IGroup | undefined => {
  const group = (config.groupLevels ?? [])
    .map((level) => {
      const meta = ctx.resolveField(level.columnId);
      if (!meta) return undefined;
      return {
        fieldId: meta.fieldId,
        order: level.order === 'descending' ? SortFunc.Desc : SortFunc.Asc,
      };
    })
    .filter((item): item is { fieldId: string; order: SortFunc } => item != null);
  return group.length > 0 ? group : undefined;
};

const metadataFieldId = (
  metadata: Record<string, unknown> | undefined,
  path: string[],
  ctx: IViewConfigMapperContext
): string | undefined => {
  let node: unknown = metadata;
  for (const key of path) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === 'string' ? ctx.resolveField(node)?.fieldId : undefined;
};

const kanbanOptions = (config: IAirtableViewConfig, ctx: IViewConfigMapperContext) => {
  const options: Record<string, unknown> = {};
  // Airtable models the kanban "stack by" as the single group level.
  const stackColumnId = config.groupLevels?.[0]?.columnId;
  const stackFieldId = stackColumnId ? ctx.resolveField(stackColumnId)?.fieldId : undefined;
  if (stackFieldId) options.stackFieldId = stackFieldId;
  const coverFieldId = metadataFieldId(config.metadata, ['kanban', 'coverColumnId'], ctx);
  if (coverFieldId) options.coverFieldId = coverFieldId;
  return options;
};

const calendarOptions = (config: IAirtableViewConfig, ctx: IViewConfigMapperContext) => {
  const ranges = (
    config.metadata?.calendar as { dateColumnRanges?: Array<{ startColumnId?: string }> }
  )?.dateColumnRanges;
  const startColumnId = ranges?.[0]?.startColumnId;
  const startDateFieldId = startColumnId ? ctx.resolveField(startColumnId)?.fieldId : undefined;
  return startDateFieldId ? { startDateFieldId } : {};
};

const gridOptions = (config: IAirtableViewConfig, onDrop: (reason: string) => void) => {
  const rawRowHeight = (config.metadata?.grid as { rowHeight?: string })?.rowHeight;
  if (!rawRowHeight) return {};
  const rowHeight = rowHeightMap[rawRowHeight];
  if (rowHeight) return { rowHeight };
  onDrop(`row height "${rawRowHeight}" is not supported`);
  return {};
};

const mapOptions = (
  teableViewType: ViewType,
  config: IAirtableViewConfig,
  ctx: IViewConfigMapperContext,
  onDrop: (reason: string) => void
): Record<string, unknown> | undefined => {
  const builders: Partial<Record<ViewType, () => Record<string, unknown>>> = {
    [ViewType.Kanban]: () => kanbanOptions(config, ctx),
    [ViewType.Gallery]: () => {
      const coverFieldId = metadataFieldId(config.metadata, ['gallery', 'coverColumnId'], ctx);
      return coverFieldId ? { coverFieldId } : {};
    },
    [ViewType.Calendar]: () => calendarOptions(config, ctx),
    [ViewType.Grid]: () => gridOptions(config, onDrop),
  };
  const options = builders[teableViewType]?.() ?? {};
  return Object.keys(options).length > 0 ? options : undefined;
};

/**
 * Maps one Airtable view's configuration to Teable filter/sort/group/options.
 * Anything that cannot be converted faithfully is dropped and reported, never
 * guessed — the core import is unaffected.
 */
export const mapAirtableViewConfig = (params: {
  teableViewType: ViewType;
  config: IAirtableViewConfig;
  ctx: IViewConfigMapperContext;
  tableName: string;
  viewName: string;
  issues: IImportAirtableIssue[];
}): IMappedViewConfig => {
  const { teableViewType, config, ctx, tableName, viewName, issues } = params;
  const droppedReasons = new Set<string>();
  const onDrop = (reason: string) => droppedReasons.add(reason);

  const filter = config.filters ? mapFilterNode(config.filters, ctx, onDrop) : undefined;
  const sort = mapSorts(config, ctx);
  // For kanban the single group level is the stack field, not a row grouping.
  const group = teableViewType === ViewType.Kanban ? undefined : mapGroups(config, ctx);
  const options = mapOptions(teableViewType, config, ctx, onDrop);

  for (const reason of droppedReasons) {
    issues.push({ code: 'viewConfigDegraded', tableName, viewName, reason });
  }

  return { filter: filter ?? undefined, sort, group, options };
};
