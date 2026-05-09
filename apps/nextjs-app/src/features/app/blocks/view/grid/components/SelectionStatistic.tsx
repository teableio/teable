import { CellValueType, StatisticsFunc } from '@teable/core';
import { HelpCircle } from '@teable/icons';
import {
  statisticsValue2DisplayValue,
  useFields,
  useGridViewStore,
  type IFieldInstance,
  type IRecordIndexMap,
} from '@teable/sdk';
import type { CombinedSelection } from '@teable/sdk/components/grid/managers';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from '@teable/ui-lib';
import Decimal from 'decimal.js-light';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { tableConfig } from '@/features/i18n/table.config';

interface ISelectionStatisticProps {
  recordMap: IRecordIndexMap;
  columns: { id: string }[];
}

interface IComputed {
  sum: Decimal;
  count: number;
  average: Decimal;
  representativeField: IFieldInstance;
}

const pickRepresentativeField = (
  columns: { id: string }[],
  fields: IFieldInstance[],
  c0: number,
  c1: number
): IFieldInstance | undefined => {
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  for (let c = c0; c <= c1; c++) {
    const field = fieldById.get(columns[c]?.id);
    if (field?.cellValueType === CellValueType.Number) return field;
  }
  return undefined;
};

// One-to-one Lookup fields whose source is a Number can come back as a string
// because v2's lookup normalization may drop cellValueType, making the SDK
// instantiate them as SingleLineTextField. Coerce strings to numbers in that
// narrow case so the user sees lookup numbers in the totals.
const isCoercibleStringField = (field: IFieldInstance) =>
  field.isLookup === true && field.isMultipleCellValue !== true;

// Decimal arithmetic via decimal.js-light: avoids float-rounding compounding
// (0.1 + 0.2 ≠ 0.3) when summing many cells, and stays precise past
// Number.MAX_SAFE_INTEGER. We only convert back to JS number at the display
// boundary.
const toDecimal = (v: unknown, coerceString: boolean): Decimal | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return new Decimal(v);
  if (coerceString && typeof v === 'string' && v.trim() !== '') {
    try {
      return new Decimal(v);
    } catch {
      return null;
    }
  }
  return null;
};

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
  const tally = (v: unknown, coerceString: boolean) => {
    const d = toDecimal(v, coerceString);
    if (d == null) return;
    sum = sum.plus(d);
    count += 1;
  };
  for (let r = r0; r <= r1; r++) {
    const record = recordMap[r];
    if (!record) continue;
    for (let c = c0; c <= c1; c++) {
      const field = fieldById.get(columns[c]?.id);
      if (!field) continue;
      const coerce = isCoercibleStringField(field);
      const value = record.getCellValue(field.id);
      if (Array.isArray(value)) value.forEach((el) => tally(el, coerce));
      else tally(value, coerce);
    }
  }
  return { sum, count };
};

export const computeSelectionStatistic = (
  selection: CombinedSelection | undefined,
  recordMap: IRecordIndexMap,
  columns: { id: string }[],
  fields: IFieldInstance[]
): IComputed | null => {
  if (!selection?.isCellSelection) return null;
  const ranges = selection.serialize();
  if (ranges.length < 2) return null;
  const [[c0, r0], [c1, r1]] = ranges;
  if ((c1 - c0 + 1) * (r1 - r0 + 1) < 2) return null;

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

// Wrap render in an ErrorBoundary so any throw inside (a malformed cell value,
// a stale field reference, etc.) is contained to this overlay and never tears
// down the surrounding grid.
export const SelectionStatistic = (props: ISelectionStatisticProps) => (
  <ErrorBoundary fallback={null}>
    <SelectionStatisticInner {...props} />
  </ErrorBoundary>
);

const SelectionStatisticInner = (props: ISelectionStatisticProps) => {
  const { recordMap, columns } = props;
  const { selection } = useGridViewStore();
  const fields = useFields();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const computed = useMemo<IComputed | null>(
    () => computeSelectionStatistic(selection, recordMap, columns, fields),
    [selection, recordMap, columns, fields]
  );

  if (!computed) return null;

  const { sum, average, count, representativeField } = computed;
  // Display: max 3 decimals, drop trailing zeros (1.5, 1.333, 2 — not 1.50, 2.00).
  const trimDecimals = (d: Decimal) => Number(d.toFixed(3)).toString();
  const formatSum = (d: Decimal) =>
    statisticsValue2DisplayValue(StatisticsFunc.Sum, d.toNumber(), representativeField) ??
    trimDecimals(d);
  const formatAverage = trimDecimals;

  return (
    <div
      className={cn(
        'fixed bottom-16 right-16 z-40 flex items-center gap-3',
        'whitespace-nowrap rounded-full border bg-background px-3 py-1.5 text-xs shadow-md'
      )}
    >
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex shrink-0 items-center text-muted-foreground hover:text-foreground"
              aria-label={t('sdk:selectionStatistic.tip')}
            >
              <HelpCircle className="size-3.5" />
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
      </TooltipProvider>
      <span className="h-3 w-px bg-border" />
      <span>
        <span className="text-muted-foreground">{t('sdk:statisticFunc.average')}: </span>
        <span className="font-medium">{formatAverage(average)}</span>
      </span>
      <span className="h-3 w-px bg-border" />
      <span>
        <span className="text-muted-foreground">{t('sdk:statisticFunc.count')}: </span>
        <span className="font-medium">{count}</span>
      </span>
      <span className="h-3 w-px bg-border" />
      <span>
        <span className="text-muted-foreground">{t('sdk:statisticFunc.sum')}: </span>
        <span className="font-medium">{formatSum(sum)}</span>
      </span>
    </div>
  );
};
