import {
  analyzePeriodicRefreshSpec,
  type IPeriodicRefreshFieldInput,
  type IPeriodicRefreshSpec,
  type IRelativeDateFilterHit,
  sanitizePeriodicRefreshTimeZone,
} from './periodic-refresh-analyzer';

export interface ILocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** YYYY-MM-DD in the target IANA timeZone */
  localDate: string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const safeTz = sanitizePeriodicRefreshTimeZone(timeZone);
  let fmt = formatterCache.get(safeTz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    formatterCache.set(safeTz, fmt);
  }
  return fmt;
};

export const getLocalDateParts = (now: Date, timeZone: string): ILocalDateParts => {
  const parts = getFormatter(timeZone).formatToParts(now);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      lookup[part.type] = part.value;
    }
  }
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const rawHour = Number(lookup.hour);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(lookup.minute);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return {
    year,
    month,
    day,
    hour,
    minute,
    localDate: `${year}-${pad2(month)}-${pad2(day)}`,
  };
};

const toUtcDate = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day));

const formatUtcIsoDate = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addDays = (d: Date, delta: number): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta));

const addMonths = (d: Date, deltaMonths: number): Date => {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + deltaMonths, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(d.getUTCDate(), lastDayOfTargetMonth);
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), clampedDay));
};

const addYears = (d: Date, deltaYears: number): Date => addMonths(d, deltaYears * 12);

const startEndOfWeekMonday = (d: Date): [Date, Date] => {
  // getUTCDay(): 0 = Sun, 1 = Mon ... 6 = Sat
  const dow = d.getUTCDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const start = addDays(d, diffToMon);
  const end = addDays(start, 6);
  return [start, end];
};

const startEndOfMonth = (year: number, monthIndex0: number): [Date, Date] => {
  const start = new Date(Date.UTC(year, monthIndex0, 1));
  const end = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  return [start, end];
};

const startEndOfYear = (year: number): [Date, Date] => [
  new Date(Date.UTC(year, 0, 1)),
  new Date(Date.UTC(year, 11, 31)),
];

const computeRelativeHitBounds = (
  hit: IRelativeDateFilterHit,
  parts: ILocalDateParts
): [string, string] => {
  const base = toUtcDate(parts.year, parts.month, parts.day);
  const n = hit.numberOfDays ?? 0;

  let start: Date;
  let end: Date;

  switch (hit.mode) {
    case 'today':
      start = end = base;
      break;
    case 'tomorrow':
      start = end = addDays(base, 1);
      break;
    case 'yesterday':
      start = end = addDays(base, -1);
      break;
    case 'oneWeekAgo':
      start = end = addDays(base, -7);
      break;
    case 'oneWeekFromNow':
      start = end = addDays(base, 7);
      break;
    case 'oneMonthAgo':
      start = end = addMonths(base, -1);
      break;
    case 'oneMonthFromNow':
      start = end = addMonths(base, 1);
      break;
    case 'daysAgo':
      start = end = addDays(base, -n);
      break;
    case 'daysFromNow':
      start = end = addDays(base, n);
      break;
    case 'pastWeek':
      start = addWeeksCompat(base, -1);
      end = base;
      break;
    case 'pastMonth':
      start = addMonths(base, -1);
      end = base;
      break;
    case 'pastYear':
      start = addYears(base, -1);
      end = base;
      break;
    case 'nextWeek':
      start = base;
      end = addWeeksCompat(base, 1);
      break;
    case 'nextMonth':
      start = base;
      end = addMonths(base, 1);
      break;
    case 'nextYear':
      start = base;
      end = addYears(base, 1);
      break;
    case 'pastNumberOfDays':
      start = addDays(base, -n);
      end = base;
      break;
    case 'nextNumberOfDays':
      start = base;
      end = addDays(base, n);
      break;
    case 'currentWeek':
      [start, end] = startEndOfWeekMonday(base);
      break;
    case 'lastWeek':
      [start, end] = startEndOfWeekMonday(addDays(base, -7));
      break;
    case 'nextWeekPeriod':
      [start, end] = startEndOfWeekMonday(addDays(base, 7));
      break;
    case 'currentMonth':
      [start, end] = startEndOfMonth(base.getUTCFullYear(), base.getUTCMonth());
      break;
    case 'lastMonth':
      [start, end] = startEndOfMonth(base.getUTCFullYear(), base.getUTCMonth() - 1);
      break;
    case 'nextMonthPeriod':
      [start, end] = startEndOfMonth(base.getUTCFullYear(), base.getUTCMonth() + 1);
      break;
    case 'currentYear':
      [start, end] = startEndOfYear(base.getUTCFullYear());
      break;
    case 'lastYear':
      [start, end] = startEndOfYear(base.getUTCFullYear() - 1);
      break;
    case 'nextYearPeriod':
      [start, end] = startEndOfYear(base.getUTCFullYear() + 1);
      break;
    default:
      start = end = base;
  }

  return [formatUtcIsoDate(start), formatUtcIsoDate(end)];
};

const addWeeksCompat = (d: Date, weeks: number): Date => addDays(d, weeks * 7);

const fnv1aHex = (input: string): string => {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
};

export interface IComputedPeriodicRangeHash {
  localDate: string;
  timeZone: string;
  rangeHash: string;
}

/**
 * Compute the canonical rangeHash representing the active time interval(s) of
 * a periodic-refresh field at `now`. When two consecutive days produce the exact
 * same `rangeHash` (e.g., `currentMonth` on Aug 18 vs Aug 19), the scheduler can
 * short-circuit without touching tenant data DBs.
 */
export const computePeriodicRefreshRangeHash = (
  field: IPeriodicRefreshFieldInput,
  now: Date
): IComputedPeriodicRangeHash | null => {
  const spec = analyzePeriodicRefreshSpec(field);
  if (!spec.supported) return null;

  const primaryParts = getLocalDateParts(now, spec.timeZone);
  if (spec.sourceType === 'formula') {
    const raw = `formula:${spec.timeZone}:${primaryParts.localDate}`;
    return {
      localDate: primaryParts.localDate,
      timeZone: spec.timeZone,
      rangeHash: `f:${primaryParts.localDate}:${fnv1aHex(raw)}`,
    };
  }

  const tokens = spec.relativeHits
    .map((hit) => {
      const hitParts =
        hit.timeZone === spec.timeZone ? primaryParts : getLocalDateParts(now, hit.timeZone);
      const [startIso, endIso] = computeRelativeHitBounds(hit, hitParts);
      return `${hit.mode}:${hit.numberOfDays ?? ''}:${hit.timeZone}=${startIso}..${endIso}`;
    })
    .sort();

  const signature = tokens.join('|');
  return {
    localDate: primaryParts.localDate,
    timeZone: spec.timeZone,
    rangeHash: `r:${fnv1aHex(signature)}`,
  };
};

/**
 * Deterministic jitter minute in `[0, 14]` per `baseId` so midnight refreshes across
 * all timezones spread evenly over the 00:00–00:14 window.
 */
export const computeBaseJitterMinute = (baseId: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < baseId.length; i++) {
    hash ^= baseId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 15;
};

/**
 * Returns true if the local calendar date in `timeZone` has advanced past
 * `lastRefreshedLocalDate` and the per-base jitter minute has elapsed for the
 * midnight `00:xx` hour (or any later hour if catching up).
 */
export const isFieldDueForScheduledRefresh = (params: {
  now: Date;
  timeZone: string;
  lastRefreshedLocalDate?: string | null;
  baseId: string;
}): boolean => {
  const parts = getLocalDateParts(params.now, params.timeZone);
  if (params.lastRefreshedLocalDate === parts.localDate) {
    return false;
  }
  if (parts.hour === 0 && parts.minute < computeBaseJitterMinute(params.baseId)) {
    return false;
  }
  return true;
};

const hasSecondaryTimezoneRangeChange = (params: {
  field: IPeriodicRefreshFieldInput;
  spec: Extract<IPeriodicRefreshSpec, { supported: true }>;
  now: Date;
  lastRangeHash?: string | null;
}): boolean => {
  if (params.spec.sourceType !== 'filter') {
    return false;
  }
  const distinctCount = new Set(params.spec.relativeHits.map((h) => h.timeZone)).size;
  if (distinctCount <= 1) {
    return false;
  }
  const currentRangeHash = computePeriodicRefreshRangeHash(params.field, params.now)?.rangeHash;
  return Boolean(currentRangeHash && currentRangeHash !== params.lastRangeHash);
};

const computeMaxMidnightJitterDelayMs = (
  timeZones: ReadonlyArray<string>,
  now: Date,
  baseId: string
): number => {
  const jitter = computeBaseJitterMinute(baseId);
  const secondsOffsetMs = now.getSeconds() * 1000 + now.getMilliseconds();
  let maxDelayMs = 0;

  for (const tz of timeZones) {
    const parts = getLocalDateParts(now, tz);
    if (parts.hour === 0 && parts.minute < jitter) {
      const remainingMs = (jitter - parts.minute) * 60_000 - secondsOffsetMs;
      if (remainingMs > maxDelayMs) {
        maxDelayMs = remainingMs;
      }
    }
  }

  return Math.min(maxDelayMs, 14 * 60_000);
};

/**
 * Returns `null` when the field is not due (same local date / unchanged multi-timezone rangeHash),
 * `0` when it should execute immediately (past jitter window or catch-up hours),
 * or a positive delay in milliseconds within `(0, 14m]` to spread midnight execution across
 * the 00:00-00:14 window by `baseId`.
 */
export const computeScheduledRefreshDelayMs = (params: {
  field: IPeriodicRefreshFieldInput;
  spec: IPeriodicRefreshSpec;
  now: Date;
  lastRefreshedLocalDate?: string | null;
  lastRangeHash?: string | null;
  baseId: string;
}): number | null => {
  if (!params.spec.supported) {
    return null;
  }
  if (!params.spec.containsNowPrecision && params.lastRangeHash) {
    const currentRangeHash = computePeriodicRefreshRangeHash(params.field, params.now)?.rangeHash;
    if (currentRangeHash && currentRangeHash === params.lastRangeHash) {
      return null;
    }
  }
  const primaryParts = getLocalDateParts(params.now, params.spec.timeZone);
  const primaryDateChanged = params.lastRefreshedLocalDate !== primaryParts.localDate;
  if (
    !primaryDateChanged &&
    !hasSecondaryTimezoneRangeChange({
      field: params.field,
      spec: params.spec,
      now: params.now,
      lastRangeHash: params.lastRangeHash,
    })
  ) {
    return null;
  }
  const activeTimeZones =
    params.spec.sourceType === 'filter'
      ? [...new Set(params.spec.relativeHits.map((h) => h.timeZone))]
      : [params.spec.timeZone];
  return computeMaxMidnightJitterDelayMs(activeTimeZones, params.now, params.baseId);
};

/**
 * Evaluates scheduled due state for a field spec. Handles single-timezone fields
 * as well as relative-date filter groups spanning multiple IANA timezones: once
 * the primary timezone has refreshed today, a secondary timezone crossing
 * midnight later in the same primary calendar day still triggers when its
 * combined `rangeHash` changes and its jitter window has elapsed.
 */
export const isSpecDueForScheduledRefresh = (params: {
  field: IPeriodicRefreshFieldInput;
  spec: IPeriodicRefreshSpec;
  now: Date;
  lastRefreshedLocalDate?: string | null;
  lastRangeHash?: string | null;
  baseId: string;
}): boolean => computeScheduledRefreshDelayMs(params) === 0;
