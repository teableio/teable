import {
  CharStreams,
  CommonTokenStream,
  Formula,
  FormulaLexer,
  FunctionCallCollectorVisitor,
} from '@teable/formula';
import { normalizeFunctionNameAlias } from '../../../formula/function-aliases';
import { FunctionName } from '../../../formula/functions/common';
import type { IFilter, IFilterSet } from '../../view/filter/filter';
import type { IDateFilter } from '../../view/filter/filter-item';
import { FieldType } from '../constant';
import type { PeriodicRefreshCadence } from './periodic-refresh.schema';

export const VOLATILE_TIME_FUNCTIONS: ReadonlySet<string> = new Set([
  FunctionName.Today,
  FunctionName.Now,
  FunctionName.FromNow,
  FunctionName.ToNow,
]);

export const DAY_RELATIVE_DATE_MODES = [
  'today',
  'tomorrow',
  'yesterday',
  'oneWeekAgo',
  'oneWeekFromNow',
  'oneMonthAgo',
  'oneMonthFromNow',
  'daysAgo',
  'daysFromNow',
  'pastWeek',
  'pastMonth',
  'pastYear',
  'nextWeek',
  'nextMonth',
  'nextYear',
  'pastNumberOfDays',
  'nextNumberOfDays',
] as const;

export const WEEK_RELATIVE_DATE_MODES = ['currentWeek', 'lastWeek', 'nextWeekPeriod'] as const;

export const MONTH_RELATIVE_DATE_MODES = [
  'currentMonth',
  'lastMonth',
  'nextMonthPeriod',
  'currentYear',
  'lastYear',
  'nextYearPeriod',
] as const;

export const EXACT_DATE_MODES: ReadonlySet<string> = new Set([
  'exactDate',
  'exactDateTime',
  'exactFormatDate',
  'dateRange',
]);

const MODE_CADENCE_MAP = new Map<string, PeriodicRefreshCadence>([
  ...DAY_RELATIVE_DATE_MODES.map((m): [string, PeriodicRefreshCadence] => [m, 'day']),
  ...WEEK_RELATIVE_DATE_MODES.map((m): [string, PeriodicRefreshCadence] => [m, 'week']),
  ...MONTH_RELATIVE_DATE_MODES.map((m): [string, PeriodicRefreshCadence] => [m, 'month']),
]);

export const ALL_RELATIVE_DATE_MODES: ReadonlySet<string> = new Set(MODE_CADENCE_MAP.keys());

const CADENCE_RANK: Record<PeriodicRefreshCadence, number> = {
  day: 0,
  week: 1,
  month: 2,
};

export interface IRelativeDateFilterHit {
  mode: string;
  cadence: PeriodicRefreshCadence;
  timeZone: string;
  numberOfDays?: number;
}

export type IPeriodicRefreshSpec =
  | {
      supported: false;
    }
  | {
      supported: true;
      sourceType: 'formula' | 'filter';
      cadence: PeriodicRefreshCadence;
      timeZone: string;
      containsNowPrecision: boolean;
      volatileFunctions: string[];
      relativeHits: IRelativeDateFilterHit[];
    };

export interface IPeriodicRefreshFieldInput {
  type?: string;
  isLookup?: boolean;
  isConditionalLookup?: boolean;
  options?: unknown;
  lookupOptions?: unknown;
}

export const sanitizePeriodicRefreshTimeZone = (timeZone: unknown): string => {
  if (typeof timeZone !== 'string' || !timeZone.trim()) {
    return 'UTC';
  }
  const trimmed = timeZone.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return trimmed;
  } catch {
    return 'UTC';
  }
};

export const collectFormulaFunctionCallsSafe = (expression: string): string[] => {
  if (!expression || !expression.trim()) return [];
  try {
    const inputStream = CharStreams.fromString(expression);
    const lexer = new FormulaLexer(inputStream);
    lexer.removeErrorListeners();
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new Formula(tokenStream);
    parser.removeErrorListeners();
    let hasSyntaxError = false;
    parser.addErrorListener({
      syntaxError: () => {
        hasSyntaxError = true;
      },
    });
    const tree = parser.root();
    if (hasSyntaxError) {
      return [];
    }
    const collector = new FunctionCallCollectorVisitor();
    const calls = collector.visit(tree);
    return calls.map((c) => normalizeFunctionNameAlias(c.name.toUpperCase()));
  } catch {
    return [];
  }
};

const isFilterSet = (node: unknown): node is IFilterSet =>
  Boolean(node && typeof node === 'object' && Array.isArray((node as IFilterSet).filterSet));

const isRelativeDateFilterValue = (value: unknown): value is IDateFilter => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<IDateFilter>;
  return typeof candidate.mode === 'string' && ALL_RELATIVE_DATE_MODES.has(candidate.mode);
};

const toRelativeDateFilterHit = (
  item: unknown,
  fallbackTimeZone: string
): IRelativeDateFilterHit | undefined => {
  if (!item || typeof item !== 'object' || !('value' in item)) return undefined;
  const filterItem = item as { value?: unknown };
  if (!isRelativeDateFilterValue(filterItem.value)) return undefined;
  const cadence = MODE_CADENCE_MAP.get(filterItem.value.mode);
  if (!cadence) return undefined;
  return {
    mode: filterItem.value.mode,
    cadence,
    timeZone: sanitizePeriodicRefreshTimeZone(filterItem.value.timeZone ?? fallbackTimeZone),
    ...(typeof filterItem.value.numberOfDays === 'number'
      ? { numberOfDays: filterItem.value.numberOfDays }
      : {}),
  };
};

export const collectRelativeDateFilterHits = (
  filter: IFilter | null | undefined,
  fallbackTimeZone = 'UTC'
): IRelativeDateFilterHit[] => {
  if (!filter || !isFilterSet(filter)) return [];
  const hits: IRelativeDateFilterHit[] = [];

  const visit = (nodes: IFilterSet['filterSet']) => {
    for (const item of nodes) {
      if (!item || typeof item !== 'object') continue;
      if (isFilterSet(item)) {
        visit(item.filterSet);
        continue;
      }
      const hit = toRelativeDateFilterHit(item, fallbackTimeZone);
      if (hit) hits.push(hit);
    }
  };

  visit(filter.filterSet);
  return hits;
};

const pickShortestCadence = (
  hits: ReadonlyArray<IRelativeDateFilterHit>
): PeriodicRefreshCadence => {
  let best: PeriodicRefreshCadence = 'month';
  for (const hit of hits) {
    if (CADENCE_RANK[hit.cadence] < CADENCE_RANK[best]) {
      best = hit.cadence;
    }
  }
  return best;
};

const parseJsonObject = (raw: unknown): Record<string, unknown> | undefined => {
  if (!raw) return undefined;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
};

const parseFilterValue = (raw: unknown): IFilter | undefined => {
  if (!raw) return undefined;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as IFilter;
    } catch {
      return undefined;
    }
  }
  return raw as IFilter;
};

/**
 * Statically inspect a field definition to determine whether it depends on
 * wall-clock time (TODAY/NOW/FROMNOW/TONOW) or relative date filters.
 */
export const analyzePeriodicRefreshSpec = (
  field: IPeriodicRefreshFieldInput
): IPeriodicRefreshSpec => {
  const options = parseJsonObject(field.options);
  const lookupOptions = parseJsonObject(field.lookupOptions);

  if (!field.isLookup && field.type === FieldType.Formula) {
    const expression = typeof options?.expression === 'string' ? options.expression : '';
    const calls = collectFormulaFunctionCallsSafe(expression);
    const volatileFunctions = [...new Set(calls.filter((fn) => VOLATILE_TIME_FUNCTIONS.has(fn)))];
    if (volatileFunctions.length === 0) {
      return { supported: false };
    }
    return {
      supported: true,
      sourceType: 'formula',
      cadence: 'day',
      timeZone: sanitizePeriodicRefreshTimeZone(options?.timeZone),
      containsNowPrecision: volatileFunctions.some((fn) => fn !== FunctionName.Today),
      volatileFunctions,
      relativeHits: [],
    };
  }

  let filter: IFilter | undefined;
  if (field.type === FieldType.ConditionalRollup) {
    filter = parseFilterValue(options?.filter);
  } else if (field.isLookup || field.type === FieldType.Rollup) {
    filter = parseFilterValue(lookupOptions?.filter);
  }

  if (!filter) {
    return { supported: false };
  }

  const optionsTimeZone = sanitizePeriodicRefreshTimeZone(options?.timeZone);
  const relativeHits = collectRelativeDateFilterHits(filter, optionsTimeZone);
  if (relativeHits.length === 0) {
    return { supported: false };
  }

  return {
    supported: true,
    sourceType: 'filter',
    cadence: pickShortestCadence(relativeHits),
    timeZone: relativeHits[0]?.timeZone ?? optionsTimeZone,
    containsNowPrecision: false,
    volatileFunctions: [],
    relativeHits,
  };
};
