import { useVirtualizer } from '@tanstack/react-virtual';
import type { IDateFieldOptions, ITimeZoneString } from '@teable/core';
import { TimeFormatting } from '@teable/core';
import {
  Button,
  Calendar,
  cn,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib';
import {
  addMonths,
  format,
  isBefore,
  startOfMonth,
  setMonth,
  setYear,
  type Locale,
} from 'date-fns';
import { enUS, fr, ja, ru, zhCN } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Matcher } from 'react-day-picker';
import { AppContext } from '../../../../../context';
import { useTranslation } from '../../../../../context/app/i18n';

const MIN_YEAR = 100;
const MAX_YEAR = 3000;
const START_DEFAULT_TIME = '00:00';
const END_DEFAULT_TIME = '23:59';
// Fixed height to prevent layout shift when switching calendar views
const CALENDAR_VIEW_HEIGHT = 318;

const LOCALE_MAP: Record<string, Locale> = {
  zh: zhCN,
  en: enUS,
  ja: ja,
  ru: ru,
  fr: fr,
};

// react-day-picker modifier styles for highlighting selected date range
const RANGE_MODIFIER_CLASSNAMES = {
  range_start:
    '[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:hover:!bg-primary [&>button]:hover:!text-primary-foreground rounded-l-md rounded-r-none',
  range_end:
    '[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:hover:!bg-primary [&>button]:hover:!text-primary-foreground rounded-r-md rounded-l-none',
  range_middle:
    '!bg-accent [&>button]:!bg-transparent [&>button]:!text-accent-foreground [&>button]:hover:!bg-transparent [&>button]:hover:!text-accent-foreground rounded-none',
} as const;

/**
 * Creates a date with the specified year, avoiding JavaScript's special handling of years 0-99.
 * Note: new Date(1, 0) creates year 1901 instead of year 1 (legacy behavior)
 */
const createDateWithYear = (year: number, month: number): Date => {
  const date = new Date(0);
  date.setFullYear(year, month, 1);
  date.setHours(0, 0, 0, 0);
  return date;
};

const MIN_DATE = createDateWithYear(MIN_YEAR, 0);
const MAX_DATE = createDateWithYear(MAX_YEAR, 11);

// Hide built-in calendar navigation, use custom navigation instead
const CALENDAR_CLASSNAMES = {
  month_caption: 'hidden',
  caption: 'hidden',
} as const;

const formatTimeInZone = (date: string, timeZone: string): string =>
  formatInTimeZone(date, timeZone, 'HH:mm');

const parseTimeString = (timeStr: string): [number, number] => {
  const parts = timeStr.split(':').map(Number);
  return [parts[0] || 0, parts[1] || 0];
};

const timeToMinutes = (timeStr: string): number => {
  const [h, m] = parseTimeString(timeStr);
  return h * 60 + m;
};

const isSameDayDate = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// Dates passed in are already timezone-converted local times, used directly for display
const formatDateRangeDisplay = (
  fromDate: Date | undefined,
  toDate: Date | undefined,
  fromTime: string,
  toTime: string,
  timeFormatting: TimeFormatting
): string => {
  if (!fromDate) return '';
  const hasTime = timeFormatting !== TimeFormatting.None;
  const timeFormat = timeFormatting === TimeFormatting.Hour12 ? 'hh:mm a' : 'HH:mm';
  const dateFormatStr = hasTime ? `yyyy-MM-dd ${timeFormat}` : 'yyyy-MM-dd';

  const from = new Date(fromDate);
  if (hasTime) {
    const [h, m] = parseTimeString(fromTime);
    from.setHours(h, m, 0, 0);
  }
  const fromStr = format(from, dateFormatStr);

  if (!toDate) return `${fromStr} ~ ?`;

  const to = new Date(toDate);
  if (hasTime) {
    const [h, m] = parseTimeString(toTime);
    to.setHours(h, m, 59, 999);
  }
  return `${fromStr} ~ ${format(to, dateFormatStr)}`;
};

const localizedMonthsCache = new Map<Locale, string[]>();
const getLocalizedMonths = (locale: Locale): string[] => {
  const cached = localizedMonthsCache.get(locale);
  if (cached) return cached;

  const months = Array.from({ length: 12 }, (_, i) =>
    format(new Date(2000, i, 1), 'MMM', { locale })
  );
  localizedMonthsCache.set(locale, months);
  return months;
};

// Virtual scroll row height = (calendar height - header) / 3 rows
const YEAR_ROW_HEIGHT = Math.floor((CALENDAR_VIEW_HEIGHT - 32) / 3);
const TOTAL_YEARS = MAX_YEAR - MIN_YEAR + 1;

interface IYearMonthPickerProps {
  currentMonth: Date;
  onSelect: (date: Date) => void;
  locale: Locale;
}

const YearMonthPicker = memo(function YearMonthPicker({
  currentMonth,
  onSelect,
  locale,
}: IYearMonthPickerProps) {
  const selectedYear = currentMonth.getFullYear();
  const selectedMonthIndex = currentMonth.getMonth();
  const months = useMemo(() => getLocalizedMonths(locale), [locale]);
  const parentRef = useRef<HTMLDivElement>(null);

  // Calculate initial scroll offset to center the selected year (selectedIndex - 1 places it in the middle)
  const initialOffset = useMemo(() => {
    const selectedIndex = selectedYear - MIN_YEAR;
    return Math.max(0, (selectedIndex - 1) * YEAR_ROW_HEIGHT);
  }, [selectedYear]);

  const virtualizer = useVirtualizer({
    count: TOTAL_YEARS,
    getScrollElement: () => parentRef.current,
    estimateSize: () => YEAR_ROW_HEIGHT,
    overscan: 3,
    initialOffset,
  });

  const handleMonthClick = useCallback(
    (year: number, monthIndex: number) => {
      const newDate = setMonth(setYear(new Date(), year), monthIndex);
      onSelect(newDate);
    },
    [onSelect]
  );

  const virtualItems = virtualizer.getVirtualItems();

  // Track whether user has actively scrolled, controls edge separator visibility
  const [hasScrolled, setHasScrolled] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    initializedRef.current = false;

    /**
     * Double rAF to skip the initial scroll event triggered by initialOffset:
     * Frame 1: Browser processes the initialOffset scroll
     * Frame 2: Mark initialization complete, subsequent scrolls are user-initiated
     */
    let rafId2: number;
    const rafId1 = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        initializedRef.current = true;
      });
    });

    const handleScroll = () => {
      if (!initializedRef.current) return;
      if (!hasScrolled) {
        setHasScrolled(true);
      }
    };

    el.addEventListener('scroll', handleScroll);

    return () => {
      cancelAnimationFrame(rafId1);
      cancelAnimationFrame(rafId2);
      el.removeEventListener('scroll', handleScroll);
    };
  }, [hasScrolled]);

  // Initially visible area shows 3 years
  const firstVisibleIndex = Math.floor(initialOffset / YEAR_ROW_HEIGHT);
  const lastVisibleIndex = firstVisibleIndex + 2;

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualItems.map((virtualRow) => {
          const year = MIN_YEAR + virtualRow.index;
          const isSelectedYear = year === selectedYear;
          // Hide edge separators on initial render for cleaner appearance; show all after user scrolls
          const showSeparator = hasScrolled
            ? virtualRow.index > 0
            : virtualRow.index > 0 &&
              virtualRow.index > firstVisibleIndex &&
              virtualRow.index <= lastVisibleIndex;

          return (
            <div
              key={virtualRow.key}
              className={cn(
                'absolute left-0 top-0 flex w-full items-center px-1',
                showSeparator && 'border-t border-dashed border-border/50'
              )}
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                className={cn(
                  'flex w-11 shrink-0 items-center justify-center text-sm font-medium tabular-nums',
                  isSelectedYear ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {year}
              </div>

              <div className="grid flex-1 grid-cols-4 gap-1">
                {months.map((month, idx) => {
                  const isSelected = isSelectedYear && idx === selectedMonthIndex;
                  return (
                    <Button
                      key={idx}
                      variant={isSelected ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => handleMonthClick(year, idx)}
                      className={cn(
                        'h-6 px-1.5 text-xs font-normal',
                        !isSelected && 'text-foreground hover:bg-accent'
                      )}
                    >
                      {month}
                    </Button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// react-day-picker modifiers type for marking date ranges
type RangeModifiers = Record<string, Matcher | Matcher[] | undefined>;

interface IRangeCalendarProps {
  month: Date;
  onMonthChange: (date: Date) => void;
  selected: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  rangeModifiers: RangeModifiers;
  locale: Locale;
}

const RangeCalendar = memo(function RangeCalendar({
  month,
  onMonthChange,
  selected,
  onSelect,
  rangeModifiers,
  locale,
}: IRangeCalendarProps) {
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const handleMonthSelect = useCallback(
    (date: Date) => {
      onMonthChange(date);
      setShowMonthPicker(false);
    },
    [onMonthChange]
  );

  return (
    <div className="flex w-[252px] flex-col" style={{ height: CALENDAR_VIEW_HEIGHT }}>
      <div className="flex h-8 items-center justify-between px-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => onMonthChange(addMonths(month, -1))}
          disabled={month.getFullYear() <= MIN_YEAR && month.getMonth() === 0}
        >
          <ChevronLeftIcon className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowMonthPicker(!showMonthPicker)}
          className="h-7 px-2 text-sm font-medium"
        >
          {format(month, 'MMM yyyy', { locale })}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => onMonthChange(addMonths(month, 1))}
          disabled={month.getFullYear() >= MAX_YEAR && month.getMonth() === 11}
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      {showMonthPicker ? (
        <YearMonthPicker currentMonth={month} onSelect={handleMonthSelect} locale={locale} />
      ) : (
        <Calendar
          mode="single"
          month={month}
          onMonthChange={onMonthChange}
          selected={selected}
          onSelect={onSelect}
          numberOfMonths={1}
          fixedWeeks
          locale={locale}
          startMonth={MIN_DATE}
          endMonth={MAX_DATE}
          modifiers={rangeModifiers}
          modifiersClassNames={RANGE_MODIFIER_CLASSNAMES}
          className="flex-1 bg-transparent p-0"
          hideNavigation
          classNames={CALENDAR_CLASSNAMES}
        />
      )}
    </div>
  );
});

interface ITimeInputProps {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const TimeInput = memo(function TimeInput({ label, value, onChange }: ITimeInputProps) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input type="time" value={value} onChange={onChange} className="h-8 w-20 px-2 text-xs" />
    </div>
  );
});

/**
 * Date range value structure.
 * exactDate/exactDateEnd store UTC time as ISO strings
 */
export interface IDateRangeValue {
  exactDate?: string;
  exactDateEnd?: string;
  timeZone: ITimeZoneString;
}

export interface IDateRangePickerProps {
  value: IDateRangeValue | null;
  onChange: (value: IDateRangeValue | null) => void;
  options?: IDateFieldOptions;
  className?: string;
}

export function DateRangePicker({ value, onChange, options, className }: IDateRangePickerProps) {
  const { t } = useTranslation();
  const { lang = 'en' } = useContext(AppContext);
  const locale = LOCALE_MAP[lang] || enUS;
  const [open, setOpen] = useState(false);

  const timeFormatting = options?.formatting?.time ?? TimeFormatting.None;
  const hasTimeFormat = timeFormatting !== TimeFormatting.None;
  const timeZone =
    options?.formatting?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Internal state uses timezone-converted local time for calendar display and user interaction
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [fromTime, setFromTime] = useState(START_DEFAULT_TIME);
  const [toTime, setToTime] = useState(END_DEFAULT_TIME);
  const [leftMonth, setLeftMonth] = useState(() => new Date());
  const [rightMonth, setRightMonth] = useState(() => addMonths(new Date(), 1));
  // Two-phase selection: 'start' = selecting start date, 'end' = selecting end date
  const [selectionPhase, setSelectionPhase] = useState<'start' | 'end'>('start');

  // External display value: formatted directly from value prop (UTC → timezone display)
  const displayValue = useMemo(() => {
    if (!value?.exactDate) return '';
    const tz = value.timeZone || timeZone;
    const timeFormat = timeFormatting === TimeFormatting.Hour12 ? 'hh:mm a' : 'HH:mm';
    const dateFormatStr = hasTimeFormat ? `yyyy-MM-dd ${timeFormat}` : 'yyyy-MM-dd';
    const fromStr = formatInTimeZone(value.exactDate, tz, dateFormatStr);
    if (!value.exactDateEnd) return fromStr;
    return `${fromStr} ~ ${formatInTimeZone(value.exactDateEnd, tz, dateFormatStr)}`;
  }, [
    value?.exactDate,
    value?.exactDateEnd,
    value?.timeZone,
    hasTimeFormat,
    timeFormatting,
    timeZone,
  ]);

  // Temporary display value during selection (fromDate/toDate are already local time)
  const tempDisplayValue = useMemo(
    () =>
      fromDate
        ? formatDateRangeDisplay(fromDate, toDate, fromTime, toTime, timeFormatting)
        : t('editor.date.rangePlaceholder'),
    [fromDate, toDate, fromTime, toTime, timeFormatting, t]
  );

  const isSameDay = useMemo(
    () => fromDate && toDate && isSameDayDate(fromDate, toDate),
    [fromDate, toDate]
  );

  // Same-day validation: end time must be >= start time
  const isTimeRangeValid = useMemo(() => {
    if (!hasTimeFormat || !isSameDay) return true;
    return timeToMinutes(toTime) >= timeToMinutes(fromTime);
  }, [hasTimeFormat, isSameDay, fromTime, toTime]);

  // Calendar range highlighting: range_start/range_end for endpoints, range_middle for dates in between
  const rangeModifiers = useMemo((): RangeModifiers => {
    if (!fromDate || !toDate) return {};

    // Same day doesn't need range_middle
    if (isSameDay) {
      return {
        range_start: fromDate,
        range_end: toDate,
      };
    }

    return {
      range_start: fromDate,
      range_end: toDate,
      range_middle: { after: fromDate, before: toDate },
    };
  }, [fromDate, toDate, isSameDay]);

  /**
   * Initialize state when popover opens.
   * Converts stored UTC time to local time for display and selection
   */
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (!isOpen) return;

      const tz = value?.timeZone || timeZone;
      // UTC → local time (for calendar display and user interaction)
      const from = value?.exactDate ? toZonedTime(value.exactDate, tz) : undefined;
      const to = value?.exactDateEnd ? toZonedTime(value.exactDateEnd, tz) : undefined;
      const left = from ?? toZonedTime(new Date(), tz);

      setFromDate(from);
      setToDate(to);
      setFromTime(value?.exactDate ? formatTimeInZone(value.exactDate, tz) : START_DEFAULT_TIME);
      setToTime(value?.exactDateEnd ? formatTimeInZone(value.exactDateEnd, tz) : END_DEFAULT_TIME);
      setLeftMonth(left);

      // Right calendar shows month after left, or end date's month if later
      const rightMonthValue =
        to && startOfMonth(to).getTime() > startOfMonth(left).getTime() ? to : addMonths(left, 1);
      setRightMonth(rightMonthValue);

      // If both dates exist, start fresh; if only start exists, continue selecting end date
      const phase = from && to ? 'start' : from ? 'end' : 'start';
      setSelectionPhase(phase);
    },
    [value, timeZone]
  );

  /**
   * Two-phase date selection: first click sets start date, second click sets end date.
   * Auto-sorts: if end date is before start date, swaps them (supports selection in either direction)
   */
  const handleDateSelect = useCallback(
    (date: Date | undefined) => {
      // date is undefined when clicking an already-selected date (deselection)
      // During end-date phase, clicking the selected start date → creates same-day range
      if (!date && selectionPhase === 'end' && fromDate) {
        setToDate(new Date(fromDate));
        setSelectionPhase('start');
        return;
      }

      if (!date) return;

      if (selectionPhase === 'start' || !fromDate) {
        setFromDate(date);
        setToDate(undefined);
        setSelectionPhase('end');
      } else {
        // Auto-sort: ensure fromDate <= toDate
        if (isBefore(date, fromDate)) {
          setToDate(fromDate);
          setFromDate(date);
        } else {
          setToDate(date);
        }
        setSelectionPhase('start');
      }
    },
    [selectionPhase, fromDate]
  );

  // When left calendar changes, ensure right calendar always shows a later month
  const handleLeftMonthChange = useCallback((month: Date) => {
    setLeftMonth(month);
    setRightMonth((prev) =>
      startOfMonth(prev).getTime() <= startOfMonth(month).getTime() ? addMonths(month, 1) : prev
    );
  }, []);

  // Right calendar cannot be earlier than or equal to left calendar
  const handleRightMonthChange = useCallback(
    (month: Date) => {
      if (startOfMonth(month).getTime() <= startOfMonth(leftMonth).getTime()) {
        setRightMonth(addMonths(leftMonth, 1));
      } else {
        setRightMonth(month);
      }
    },
    [leftMonth]
  );

  const handleFromTimeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFromTime(e.target.value);
  }, []);

  const handleToTimeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setToTime(e.target.value);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!fromDate || !toDate) return;

    const from = new Date(fromDate);
    const to = new Date(toDate);

    if (hasTimeFormat) {
      const [fh, fm] = parseTimeString(fromTime);
      const [th, tm] = parseTimeString(toTime);
      from.setHours(fh, fm, 0, 0);
      // Set end time to 59 seconds 999 milliseconds to include all moments within that minute
      to.setHours(th, tm, 59, 999);
    } else {
      // Without time format: start at 00:00:00, end at 23:59:59.999
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    }

    // Local time → UTC (for storage)
    onChange({
      exactDate: fromZonedTime(from, timeZone).toISOString(),
      exactDateEnd: fromZonedTime(to, timeZone).toISOString(),
      timeZone: timeZone as ITimeZoneString,
    });
    setOpen(false);
  }, [fromDate, toDate, fromTime, toTime, hasTimeFormat, timeZone, onChange]);

  const isConfirmDisabled = !fromDate || !toDate || !isTimeRangeValid;

  const inputWidthClass = useMemo(() => {
    if (timeFormatting === TimeFormatting.Hour12) return 'w-72';
    if (timeFormatting === TimeFormatting.Hour24) return 'w-[248px]';
    return 'w-44';
  }, [timeFormatting]);

  const inputDisplayValue = displayValue || t('editor.date.rangePlaceholder');

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Input
          value={inputDisplayValue}
          readOnly
          className={cn(
            'h-8 cursor-pointer text-left',
            inputWidthClass,
            !displayValue && 'text-muted-foreground',
            className
          )}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col">
          <div className="flex gap-2 p-2">
            <div className="flex flex-col">
              <RangeCalendar
                month={leftMonth}
                onMonthChange={handleLeftMonthChange}
                selected={fromDate}
                onSelect={handleDateSelect}
                rangeModifiers={rangeModifiers}
                locale={locale}
              />
              {hasTimeFormat && (
                <TimeInput
                  label={t('editor.date.from')}
                  value={fromTime}
                  onChange={handleFromTimeChange}
                />
              )}
            </div>

            <div className="w-px bg-border" />

            <div className="flex flex-col">
              <RangeCalendar
                month={rightMonth}
                onMonthChange={handleRightMonthChange}
                selected={toDate ?? fromDate}
                onSelect={handleDateSelect}
                rangeModifiers={rangeModifiers}
                locale={locale}
              />
              {hasTimeFormat && (
                <TimeInput
                  label={t('editor.date.to')}
                  value={toTime}
                  onChange={handleToTimeChange}
                />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t px-3 py-2">
            <span className="text-sm text-muted-foreground">
              {!isTimeRangeValid ? (
                <span className="text-destructive">{t('editor.date.invalidTimeRange')}</span>
              ) : (
                <>
                  {fromDate && (
                    <span className="font-medium">{t('editor.date.rangeSelected')}: </span>
                  )}
                  {tempDisplayValue}
                </>
              )}
            </span>
            <Button size="sm" onClick={handleConfirm} disabled={isConfirmDisabled}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
