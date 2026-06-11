import { useQuery } from '@tanstack/react-query';
import { CellValueType, StatisticsFunc } from '@teable/core';
import { Check, HelpCircle, Loader2 } from '@teable/icons';
import {
  getSelectionAggregation,
  type ISelectionAggregationRo,
  type ISelectionAggregationVo,
} from '@teable/openapi';
import {
  statisticsValue2DisplayValue,
  useFields,
  useGridViewStore,
  usePersonalView,
  useTableId,
  useView,
  useViewId,
  type IFieldInstance,
  type IRecordIndexMap,
} from '@teable/sdk';
import type { CombinedSelection } from '@teable/sdk/components/grid/managers';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from '@teable/ui-lib';
import Decimal from 'decimal.js-light';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useDebounce } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';

interface ISelectionStatisticProps {
  recordMap: IRecordIndexMap;
  columns: { id: string }[];
  // Total view-ordered row count, needed so column-only and all-checkbox row
  // selections can be normalized into a [c0,r0,c1,r1] cell range.
  rowCount: number;
  // The grid's currently-collapsed group ids. Chip threads this through to the
  // backend so paginated aggregation excludes the same records the grid hides.
  collapsedGroupIds?: string[];
}

interface IComputed {
  sum: Decimal;
  count: number;
  average: Decimal;
  representativeField: IFieldInstance;
}

type IRange = readonly [c0: number, r0: number, c1: number, r1: number];

const isAggregableNumberField = (field: IFieldInstance | undefined): field is IFieldInstance =>
  !!field && field.cellValueType === CellValueType.Number && field.isMultipleCellValue !== true;

const pickRepresentativeField = (
  columns: { id: string }[],
  fields: IFieldInstance[],
  c0: number,
  c1: number
): IFieldInstance | undefined => {
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  for (let c = c0; c <= c1; c++) {
    const field = fieldById.get(columns[c]?.id);
    if (isAggregableNumberField(field)) return field;
  }
  return undefined;
};

const collectAggregableFieldIds = (
  columns: { id: string }[],
  fields: IFieldInstance[],
  c0: number,
  c1: number
): string[] => {
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const ids: string[] = [];
  for (let c = c0; c <= c1; c++) {
    const field = fieldById.get(columns[c]?.id);
    if (isAggregableNumberField(field)) ids.push(field.id);
  }
  return ids;
};

// Smallest [lo, hi] that covers every input range — used to fold non-contiguous
// row/column picks into one envelope so the chip stays a single request.
const rangesEnvelope = (ranges: ReadonlyArray<readonly [number, number]>): [number, number] => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [a, b] of ranges) {
    if (a < lo) lo = a;
    if (b > hi) hi = b;
  }
  return [lo, hi];
};

// Cell selections serialize as [[minC,minR],[maxC,maxR]]; reject single-cell.
const cellRangeFromCells = (ranges: ReadonlyArray<readonly [number, number]>): IRange | null => {
  if (ranges.length < 2) return null;
  const [[c0, r0], [c1, r1]] = ranges;
  if ((c1 - c0 + 1) * (r1 - r0 + 1) < 2) return null;
  return [c0, r0, c1, r1] as const;
};

// Normalize any of the three selection types into a single [c0,r0,c1,r1] cell
// range so the rest of the chip — frontend accumulator, backend slice request,
// representative-field picker — has a uniform input. Column / row selections
// span the whole orthogonal axis; non-contiguous picks collapse to their
// envelope. Gap rows/columns inflate the cell box but only number-typed gap
// fields can affect totals (others are filtered out downstream).
const extractCellRange = (
  selection: CombinedSelection | undefined,
  columnCount: number,
  rowCount: number
): IRange | null => {
  if (!selection) return null;
  const ranges = selection.serialize() as ReadonlyArray<readonly [number, number]>;
  if (ranges.length === 0) return null;

  if (selection.isCellSelection) return cellRangeFromCells(ranges);
  if (selection.isColumnSelection && rowCount > 0) {
    const [c0, c1] = rangesEnvelope(ranges);
    return [c0, 0, c1, rowCount - 1] as const;
  }
  if (selection.isRowSelection && columnCount > 0) {
    const [r0, r1] = rangesEnvelope(ranges);
    return [0, r0, columnCount - 1, r1] as const;
  }
  return null;
};

const isRangeFullyLoaded = (recordMap: IRecordIndexMap, r0: number, r1: number): boolean => {
  for (let r = r0; r <= r1; r++) {
    if (!recordMap[r]) return false;
  }
  return true;
};

// Decimal arithmetic via decimal.js-light: avoids float-rounding compounding
// (0.1 + 0.2 ≠ 0.3) when summing many cells, and stays precise past
// Number.MAX_SAFE_INTEGER. We only convert back to JS number at the display
// boundary.
const toDecimal = (v: unknown): Decimal | null =>
  typeof v === 'number' && Number.isFinite(v) ? new Decimal(v) : null;

const accumulateNumerics = (
  recordMap: IRecordIndexMap,
  columns: { id: string }[],
  fieldById: Map<string, IFieldInstance>,
  c0: number,
  r0: number,
  c1: number,
  r1: number
): { sum: Decimal; count: number } => {
  let sum = new Decimal(0);
  let count = 0;
  for (let r = r0; r <= r1; r++) {
    const record = recordMap[r];
    if (!record) continue;
    for (let c = c0; c <= c1; c++) {
      const field = fieldById.get(columns[c]?.id);
      if (!isAggregableNumberField(field)) continue;
      const d = toDecimal(record.getCellValue(field.id));
      if (d == null) continue;
      sum = sum.plus(d);
      count += 1;
    }
  }
  return { sum, count };
};

export const computeSelectionStatistic = (
  selection: CombinedSelection | undefined,
  recordMap: IRecordIndexMap,
  columns: { id: string }[],
  fields: IFieldInstance[],
  rowCount: number
): IComputed | null => {
  const range = extractCellRange(selection, columns.length, rowCount);
  if (!range) return null;
  const [c0, r0, c1, r1] = range;

  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const { sum, count } = accumulateNumerics(recordMap, columns, fieldById, c0, r0, c1, r1);
  if (count === 0) return null;

  return {
    sum,
    count,
    average: sum.div(count),
    representativeField:
      pickRepresentativeField(columns, fields, c0, c1) ?? fieldById.get(columns[c0]?.id)!,
  };
};

// Merge per-(field, statisticFunc) backend results into the chip's combined
// sum/count/average. The endpoint returns the standard IAggregationVo shape,
// one row per (fieldId, aggFunc) pair — same as /aggregation. We only asked for
// Sum + Filled, so total each up across the requested aggregable fields.
const decimalFrom = (value: unknown): Decimal | null => {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? new Decimal(value) : null;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return new Decimal(value);
    } catch {
      return null;
    }
  }
  return null;
};

const numberFrom = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const accumulateBackendTotals = (
  data: ISelectionAggregationVo,
  aggregableFieldIds: string[]
): { sum: Decimal; count: number } => {
  const aggregableSet = new Set(aggregableFieldIds);
  let sum = new Decimal(0);
  let count = 0;
  for (const item of data.aggregations ?? []) {
    if (!aggregableSet.has(item.fieldId)) continue;
    const { aggFunc, value } = item.total ?? {};
    if (aggFunc === StatisticsFunc.Sum) {
      sum = sum.plus(decimalFrom(value) ?? 0);
    } else if (aggFunc === StatisticsFunc.Filled) {
      count += numberFrom(value) ?? 0;
    }
  }
  return { sum, count };
};

export const mergeBackendStats = (
  data: ISelectionAggregationVo,
  aggregableFieldIds: string[],
  columns: { id: string }[],
  fields: IFieldInstance[],
  c0: number,
  c1: number
): IComputed | null => {
  const { sum, count } = accumulateBackendTotals(data, aggregableFieldIds);
  if (count === 0) return null;

  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const representativeField =
    pickRepresentativeField(columns, fields, c0, c1) ?? fieldById.get(columns[c0]?.id);
  if (!representativeField) return null;

  return {
    sum,
    count,
    average: sum.div(count),
    representativeField,
  };
};

// Wrap render in an ErrorBoundary so any throw inside (a malformed cell value,
// a stale field reference, etc.) is contained to this overlay and never tears
// down the surrounding grid.
export const SelectionStatistic = (props: ISelectionStatisticProps) => (
  <ErrorBoundary fallback={null}>
    <SelectionStatisticInner {...props} />
  </ErrorBoundary>
);

// View query state matching what AggregationProvider feeds into the records-list
// API: viewId + view.group + (optionally) the personal-view overrides
// (ignoreViewQuery, filter, orderBy, groupBy) + collapsedGroupIds so the
// backend slice mirrors the rows the grid actually shows. Search is omitted
// — paginated aggregation can't honor hide-not-match search semantics yet.
type IViewQuery = Pick<
  ISelectionAggregationRo,
  'viewId' | 'ignoreViewQuery' | 'filter' | 'orderBy' | 'groupBy' | 'collapsedGroupIds'
>;

// Hook: when the selection covers rows not yet loaded into recordMap, debounce
// 300 ms (so mid-drag values don't fire requests) and ask the server to
// aggregate the row range. The hook returns null until the server replies, and
// short-circuits to null when the selection is fully loaded again.
//
// Grouped + collapsed-group views are supported: selection row indices are
// already record-based (group headers are a pure visualization layer with no
// record index), and `collapsedGroupIds` in viewQuery makes the backend
// exclude the same hidden records, so skip/take stays aligned with the grid.
const useBackendSelectionStats = (params: {
  range: IRange | null;
  recordMap: IRecordIndexMap;
  fieldIds: string[];
  tableId: string | undefined;
  viewQuery: IViewQuery;
}): { needsBackend: boolean; data: ISelectionAggregationVo | null; isLoading: boolean } => {
  const { range, recordMap, fieldIds, tableId, viewQuery } = params;

  const needsBackend = useMemo(() => {
    if (!range || fieldIds.length === 0) return false;
    return !isRangeFullyLoaded(recordMap, range[1], range[3]);
  }, [range, recordMap, fieldIds.length]);

  const [debounced, setDebounced] = useState<{
    range: IRange;
    fieldIds: string[];
    viewQuery: IViewQuery;
  } | null>(null);

  // Track the live selection only when we actually need backend; this lets the
  // chip switch back to the frontend path the instant rows load locally.
  const viewQueryKey = JSON.stringify(viewQuery);
  const liveKey =
    needsBackend && range ? `${range.join(',')}|${fieldIds.join(',')}|${viewQueryKey}` : null;
  useDebounce(
    () => {
      if (needsBackend && range) setDebounced({ range, fieldIds, viewQuery });
      else setDebounced(null);
    },
    300,
    [liveKey]
  );

  const skip = debounced?.range[1] ?? 0;
  const take = debounced ? debounced.range[3] - debounced.range[1] + 1 : 0;
  const enabled = !!debounced && !!tableId && debounced.fieldIds.length > 0 && take > 0;

  const { data, isFetching } = useQuery({
    queryKey: [
      'selection-aggregation',
      tableId,
      viewQueryKey,
      skip,
      take,
      debounced?.fieldIds.join(',') ?? '',
    ],
    queryFn: ({ signal }) =>
      getSelectionAggregation(
        tableId!,
        {
          ...debounced!.viewQuery,
          skip,
          take,
          // Sum and Filled per field — chip combines both into its display.
          // Filled (COUNT(field)) matches the frontend's non-null cell semantics.
          field: {
            [StatisticsFunc.Sum]: debounced!.fieldIds,
            [StatisticsFunc.Filled]: debounced!.fieldIds,
          },
        },
        { signal }
      ).then((res) => res.data),
    enabled,
    // Selection results are ephemeral — never reuse, never linger.
    staleTime: 0,
    gcTime: 0,
  });

  // Loading = (a) the live selection hasn't been picked up by the debounce yet,
  // OR (b) the matching request is in flight. We can't use `!data` as the
  // loading signal: a fully-null selection produces a valid response whose
  // merged stats are null (count === 0), which would otherwise look identical
  // to "still fetching" and spin forever.
  const debouncedKey = debounced
    ? `${debounced.range.join(',')}|${debounced.fieldIds.join(',')}|${JSON.stringify(debounced.viewQuery)}`
    : null;
  const isLoading = needsBackend && (liveKey !== debouncedKey || isFetching);

  return { needsBackend, data: needsBackend ? data ?? null : null, isLoading };
};

const LoadingValue = () => (
  <Loader2 className="inline-block size-3 animate-spin text-muted-foreground" />
);

const SelectionStatisticInner = (props: ISelectionStatisticProps) => {
  const { recordMap, columns, rowCount, collapsedGroupIds } = props;
  const { selection } = useGridViewStore();
  const fields = useFields();
  const tableId = useTableId();
  const viewId = useViewId();
  const view = useView(viewId);
  const { personalViewCommonQuery } = usePersonalView();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    []
  );

  // Mirror AggregationProvider so the slice the server aggregates lines up
  // with the rows the grid actually renders: viewId + view.group by default,
  // plus the personal view's ignoreViewQuery/filter/orderBy/groupBy overrides
  // when the user has opened a personal view, plus the live collapsedGroupIds
  // from the grid so collapsed records are excluded from the slice.
  const viewGroup = view?.group;
  const viewQuery = useMemo<IViewQuery>(
    () => ({
      viewId,
      groupBy: viewGroup,
      ...(personalViewCommonQuery && {
        ignoreViewQuery: personalViewCommonQuery.ignoreViewQuery,
        filter: personalViewCommonQuery.filter,
        orderBy: personalViewCommonQuery.orderBy,
        groupBy: personalViewCommonQuery.groupBy ?? viewGroup,
      }),
      collapsedGroupIds,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewId, JSON.stringify(viewGroup), personalViewCommonQuery, JSON.stringify(collapsedGroupIds)]
  );

  const range = useMemo(
    () => extractCellRange(selection, columns.length, rowCount),
    [selection, columns.length, rowCount]
  );
  const aggregableFieldIds = useMemo(
    () => (range ? collectAggregableFieldIds(columns, fields, range[0], range[2]) : []),
    [columns, fields, range]
  );

  const {
    needsBackend,
    data: backendData,
    isLoading: backendLoading,
  } = useBackendSelectionStats({
    range,
    recordMap,
    fieldIds: aggregableFieldIds,
    tableId,
    viewQuery,
  });

  const computed = useMemo<IComputed | null>(() => {
    if (!range) return null;
    if (needsBackend) {
      return backendData
        ? mergeBackendStats(backendData, aggregableFieldIds, columns, fields, range[0], range[2])
        : null;
    }
    return computeSelectionStatistic(selection, recordMap, columns, fields, rowCount);
  }, [
    range,
    needsBackend,
    backendData,
    selection,
    recordMap,
    columns,
    fields,
    aggregableFieldIds,
    rowCount,
  ]);

  // Chip visibility: as soon as the selection is a valid multi-cell range over
  // at least one aggregable column. We render the chip even before backend
  // returns so the user gets immediate feedback; the numbers themselves switch
  // to a spinner while loading.
  const shouldRenderChip = !!range && aggregableFieldIds.length > 0;
  if (!shouldRenderChip) return null;

  const isLoading = backendLoading;
  const trimDecimals = (d: Decimal) => Number(d.toFixed(3)).toString();
  const formatSum = (d: Decimal, field: IFieldInstance) =>
    statisticsValue2DisplayValue(StatisticsFunc.Sum, d.toNumber(), field) ?? trimDecimals(d);

  const avgText = computed ? trimDecimals(computed.average) : null;
  const countText = computed ? String(computed.count) : null;
  const sumText = computed ? formatSum(computed.sum, computed.representativeField) : null;

  const handleCopy = async (key: string, value: string | null) => {
    if (isLoading || value == null) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedKey(null), 1200);
    } catch {
      // clipboard may be unavailable (e.g. insecure context); fail silently
    }
  };

  const segmentButtonClass = cn(
    'relative inline-flex items-center gap-1 rounded-md px-2 py-1',
    'transition-colors hover:bg-accent cursor-pointer active:scale-[0.98]',
    'disabled:cursor-default disabled:hover:bg-transparent'
  );

  const CopiedOverlay = () => (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center gap-1 rounded-md',
        'bg-background px-2 font-medium text-emerald-600 dark:text-emerald-500',
        'animate-in fade-in duration-150'
      )}
    >
      <Check className="size-4" strokeWidth={2.5} />
      <span>{t('sdk:selectionStatistic.copied')}</span>
    </span>
  );

  const renderStatisticButton = (
    key: string,
    label: string,
    value: string | null,
    fallback: string
  ) => (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={isLoading || value == null}
          onClick={() => handleCopy(key, value)}
          className={segmentButtonClass}
        >
          <span className="text-muted-foreground">{label}:</span>
          <span className="font-medium">{isLoading ? <LoadingValue /> : value ?? fallback}</span>
          {copiedKey === key && <CopiedOverlay />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {t('sdk:selectionStatistic.copyTip')}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div
      className={cn(
        'absolute bottom-16 right-8 z-40 flex items-center gap-2',
        'whitespace-nowrap rounded-full border bg-background px-3 py-1.5 text-xs shadow-md'
      )}
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex shrink-0 items-center text-muted-foreground hover:text-foreground"
              aria-label={t('sdk:selectionStatistic.tip')}
            >
              <HelpCircle className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={8}
            className="max-w-[260px] whitespace-normal text-xs leading-relaxed"
          >
            {t('sdk:selectionStatistic.tip')}
          </TooltipContent>
        </Tooltip>
        <span className="h-3 w-px bg-border" />
        {renderStatisticButton('avg', t('sdk:statisticFunc.average'), avgText, '—')}
        <span className="h-3 w-px bg-border" />
        {renderStatisticButton('count', t('sdk:statisticFunc.filled'), countText, '0')}
        <span className="h-3 w-px bg-border" />
        {renderStatisticButton('sum', t('sdk:statisticFunc.sum'), sumText, '—')}
      </TooltipProvider>
    </div>
  );
};
