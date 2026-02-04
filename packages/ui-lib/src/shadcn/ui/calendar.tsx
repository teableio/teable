/* eslint-disable sonarjs/cognitive-complexity */
'use client';

import { differenceInCalendarDays } from 'date-fns';
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from 'lucide-react';
import * as React from 'react';
import {
  DayPicker,
  getDefaultClassNames,
  labelNext,
  labelPrevious,
  useDayPicker,
  type DayPickerProps,
  type DayButton,
} from 'react-day-picker';
import { cn } from '../utils';
import { Button, buttonVariants } from './button';

export type CalendarProps = DayPickerProps & {
  /**
   * In the year view, the number of years to display at once.
   * @default 12
   */
  yearRange?: number;

  /**
   * Whether to show the year switcher in the caption.
   * @default true
   */
  showYearSwitcher?: boolean;

  /**
   * Button variant for navigation buttons
   * @default "ghost"
   */
  buttonVariant?: React.ComponentProps<typeof Button>['variant'];

  monthsClassName?: string;
  monthCaptionClassName?: string;
  weekdaysClassName?: string;
  weekdayClassName?: string;
  monthClassName?: string;
  captionClassName?: string;
  captionLabelClassName?: string;
  buttonNextClassName?: string;
  buttonPreviousClassName?: string;
  navClassName?: string;
  monthGridClassName?: string;
  weekClassName?: string;
  dayClassName?: string;
  dayButtonClassName?: string;
  rangeStartClassName?: string;
  rangeEndClassName?: string;
  selectedClassName?: string;
  todayClassName?: string;
  outsideClassName?: string;
  disabledClassName?: string;
  rangeMiddleClassName?: string;
  hiddenClassName?: string;

  onNavViewChange?: (navView: NavView) => void;
};

export enum NavView {
  Day = 'day',
  Year = 'year',
}

/**
 * A custom calendar component built on top of react-day-picker.
 * Supports both custom year grid navigation and dropdown selection.
 * @param props The props for the calendar.
 * @default yearRange 12
 * @returns
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  showYearSwitcher = true,
  yearRange = 12,
  numberOfMonths,
  onNavViewChange,
  captionLayout = 'label',
  buttonVariant = 'ghost',
  formatters,
  components,
  ...props
}: CalendarProps) {
  const [navView, setNavView] = React.useState<NavView>(NavView.Day);
  const [displayYears, setDisplayYears] = React.useState<{
    from: number;
    to: number;
  }>(
    React.useMemo(() => {
      const currentYear = new Date().getFullYear();
      return {
        from: currentYear - Math.floor(yearRange / 2 - 1),
        to: currentYear + Math.ceil(yearRange / 2),
      };
    }, [yearRange])
  );

  React.useEffect(() => {
    onNavViewChange?.(navView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navView]);

  const { onNextClick, onPrevClick, startMonth, endMonth } = props;

  const columnsDisplayed = navView === NavView.Year ? 1 : numberOfMonths;

  // Check if using dropdown layout
  const isDropdownLayout =
    captionLayout === 'dropdown' ||
    captionLayout === 'dropdown-months' ||
    captionLayout === 'dropdown-years';

  const defaultClassNames = getDefaultClassNames();

  // Build classNames based on layout mode
  const _monthsClassName = cn(
    isDropdownLayout ? 'flex gap-4 flex-col md:flex-row relative' : 'relative flex',
    props.monthsClassName
  );
  const _monthCaptionClassName = cn(
    isDropdownLayout
      ? 'flex items-center justify-center h-7 w-full px-7'
      : 'relative mx-10 flex h-7 items-center justify-center',
    props.monthCaptionClassName
  );
  const _weekdaysClassName = cn('flex flex-row', props.weekdaysClassName);
  const _weekdayClassName = cn(
    isDropdownLayout
      ? 'text-muted-foreground rounded-md flex-1 font-normal text-[0.8rem] select-none'
      : 'w-8 text-sm font-normal text-muted-foreground',
    props.weekdayClassName
  );
  const _monthClassName = cn(
    'w-full',
    isDropdownLayout && 'flex flex-col gap-4',
    props.monthClassName
  );
  const _captionClassName = cn(
    'relative flex items-center justify-center pt-1',
    props.captionClassName
  );
  const _captionLabelClassName = cn(
    'truncate text-sm font-medium select-none',
    isDropdownLayout
      ? 'rounded-md flex items-center gap-1 [&>svg]:text-muted-foreground [&>svg]:size-3.5'
      : '',
    props.captionLabelClassName
  );
  const buttonNavClassName = buttonVariants({
    variant: isDropdownLayout ? buttonVariant : 'outline',
    className: isDropdownLayout
      ? 'size-7 aria-disabled:opacity-50 p-0 select-none'
      : 'absolute h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100',
  });
  const _buttonNextClassName = cn(
    buttonNavClassName,
    !isDropdownLayout && 'right-0',
    props.buttonNextClassName
  );
  const _buttonPreviousClassName = cn(
    buttonNavClassName,
    !isDropdownLayout && 'left-0',
    props.buttonPreviousClassName
  );
  const _navClassName = cn(
    isDropdownLayout
      ? 'flex items-center gap-1 w-full absolute top-0 inset-x-0 justify-between'
      : 'flex items-start',
    props.navClassName
  );
  const _monthGridClassName = cn('mx-auto mt-4', props.monthGridClassName);
  const _weekClassName = cn(
    isDropdownLayout ? 'flex w-full mt-2' : 'mt-2 flex w-max items-start',
    props.weekClassName
  );
  const _dayClassName = cn(
    isDropdownLayout
      ? 'relative w-full rounded-md h-full p-0 text-center group/day aspect-square select-none'
      : 'flex size-8 flex-1 items-center justify-center p-0 text-sm',
    isDropdownLayout && props.showWeekNumber
      ? '[&:nth-child(2)[data-selected=true]_button]:rounded-l-md'
      : isDropdownLayout
        ? '[&:first-child[data-selected=true]_button]:rounded-l-md'
        : '',
    isDropdownLayout && '[&:last-child[data-selected=true]_button]:rounded-r-md',
    props.dayClassName
  );
  const _dayButtonClassName = cn(
    buttonVariants({ variant: 'ghost' }),
    'size-8 rounded-md p-0 font-normal transition-none aria-selected:opacity-100',
    props.dayButtonClassName
  );
  const buttonRangeClassName =
    'bg-accent [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground';
  const _rangeStartClassName = cn(
    isDropdownLayout
      ? 'rounded-l-md bg-muted relative after:bg-muted after:absolute after:inset-y-0 after:w-4 after:right-0 -z-0 isolate'
      : buttonRangeClassName + ' day-range-start rounded-s-md',
    props.rangeStartClassName
  );
  const _rangeEndClassName = cn(
    isDropdownLayout
      ? 'rounded-r-md bg-muted relative after:bg-muted after:absolute after:inset-y-0 after:w-4 after:left-0 -z-0 isolate'
      : buttonRangeClassName + ' day-range-end rounded-e-md',
    props.rangeEndClassName
  );
  const _rangeMiddleClassName = cn(
    isDropdownLayout
      ? 'rounded-none'
      : 'bg-accent !text-foreground [&>button]:bg-transparent [&>button]:!text-foreground [&>button]:hover:bg-transparent [&>button]:hover:!text-foreground',
    props.rangeMiddleClassName
  );
  const _selectedClassName = cn(
    '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
    props.selectedClassName
  );
  const _todayClassName = cn(
    isDropdownLayout
      ? 'bg-muted text-foreground rounded-md data-[selected=true]:rounded-none'
      : '[&>button]:bg-accent [&>button]:text-accent-foreground',
    props.todayClassName
  );
  const _outsideClassName = cn(
    'day-outside text-muted-foreground opacity-50 aria-selected:bg-accent aria-selected:text-muted-foreground aria-selected:opacity-30',
    props.outsideClassName
  );
  const _disabledClassName = cn('text-muted-foreground opacity-50', props.disabledClassName);
  const _hiddenClassName = cn('invisible flex-1', props.hiddenClassName);

  // Dropdown-specific classNames
  const _dropdownsClassName = cn(
    'w-full flex items-center text-sm font-medium justify-center h-7 gap-1.5',
    defaultClassNames.dropdowns
  );
  const _dropdownRootClassName = cn('relative rounded-md', defaultClassNames.dropdown_root);
  const _dropdownClassName = cn(
    'absolute bg-popover inset-0 opacity-0',
    defaultClassNames.dropdown
  );

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        isDropdownLayout
          ? 'p-2 [--cell-radius:var(--radius-md)] [--cell-size:1.75rem] bg-background group/calendar [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent'
          : 'p-3',
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      style={
        !isDropdownLayout
          ? {
              width: 248.8 * (columnsDisplayed ?? 1) + 'px',
            }
          : undefined
      }
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString('default', { month: 'short' }),
        ...formatters,
      }}
      classNames={{
        months: _monthsClassName,
        month_caption: _monthCaptionClassName,
        weekdays: _weekdaysClassName,
        weekday: _weekdayClassName,
        month: _monthClassName,
        caption: _captionClassName,
        caption_label: _captionLabelClassName,
        button_next: _buttonNextClassName,
        button_previous: _buttonPreviousClassName,
        nav: _navClassName,
        month_grid: _monthGridClassName,
        week: _weekClassName,
        day: _dayClassName,
        day_button: _dayButtonClassName,
        range_start: _rangeStartClassName,
        range_middle: _rangeMiddleClassName,
        range_end: _rangeEndClassName,
        selected: _selectedClassName,
        today: _todayClassName,
        outside: _outsideClassName,
        disabled: _disabledClassName,
        hidden: _hiddenClassName,
        dropdowns: _dropdownsClassName,
        dropdown_root: _dropdownRootClassName,
        dropdown: _dropdownClassName,
        table: 'w-full border-collapse',
        week_number_header: cn('select-none w-7', defaultClassNames.week_number_header),
        week_number: cn(
          'text-[0.8rem] select-none text-muted-foreground',
          defaultClassNames.week_number
        ),
        ...classNames,
      }}
      components={{
        Root: ({
          className,
          rootRef,
          ...rootProps
        }: {
          className?: string;
          rootRef?: React.Ref<HTMLDivElement>;
        } & React.HTMLAttributes<HTMLDivElement>) => {
          return (
            <div data-slot="calendar" ref={rootRef} className={cn(className)} {...rootProps} />
          );
        },
        Chevron: ({ className: chevronClassName, orientation, ...chevronProps }) => {
          if (orientation === 'left') {
            return <ChevronLeftIcon className={cn('size-4', chevronClassName)} {...chevronProps} />;
          }
          if (orientation === 'right') {
            return (
              <ChevronRightIcon className={cn('size-4', chevronClassName)} {...chevronProps} />
            );
          }
          return <ChevronDownIcon className={cn('size-4', chevronClassName)} {...chevronProps} />;
        },
        ...(isDropdownLayout
          ? {
              DayButton: CalendarDayButton,
              WeekNumber: ({
                children,
                ...weekNumberProps
              }: React.PropsWithChildren<React.TdHTMLAttributes<HTMLTableCellElement>>) => {
                return (
                  <td {...weekNumberProps}>
                    <div className="flex size-7 items-center justify-center text-center">
                      {children}
                    </div>
                  </td>
                );
              },
            }
          : {
              Nav: ({ className: navClassName }: { className?: string }) => (
                <Nav
                  className={navClassName}
                  displayYears={displayYears}
                  navView={navView}
                  setDisplayYears={setDisplayYears}
                  startMonth={startMonth}
                  endMonth={endMonth}
                  onPrevClick={onPrevClick}
                  onNextClick={onNextClick}
                />
              ),
              CaptionLabel: (captionLabelProps: React.HTMLAttributes<HTMLSpanElement>) => (
                <CaptionLabel
                  showYearSwitcher={showYearSwitcher}
                  navView={navView}
                  setNavView={setNavView}
                  displayYears={displayYears}
                  {...captionLabelProps}
                />
              ),
              MonthGrid: ({
                className: monthGridClassName,
                children,
                ...monthGridProps
              }: React.PropsWithChildren<
                { className?: string } & React.TableHTMLAttributes<HTMLTableElement>
              >) => (
                <MonthGrid
                  className={monthGridClassName}
                  displayYears={displayYears}
                  startMonth={startMonth}
                  endMonth={endMonth}
                  navView={navView}
                  setNavView={setNavView}
                  {...monthGridProps}
                >
                  {children}
                </MonthGrid>
              ),
            }),
        ...components,
      }}
      numberOfMonths={columnsDisplayed}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        'data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-muted data-[range-middle=true]:text-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 dark:hover:text-foreground relative isolate z-10 flex aspect-square size-auto w-full min-w-7 flex-col gap-1 border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] data-[range-end=true]:rounded-md data-[range-end=true]:rounded-r-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md data-[range-start=true]:rounded-l-md [&>span]:text-xs [&>span]:opacity-70',
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  );
}

function Nav({
  className,
  navView,
  startMonth,
  endMonth,
  displayYears,
  setDisplayYears,
  onPrevClick,
  onNextClick,
}: {
  className?: string;
  navView: NavView;
  startMonth?: Date;
  endMonth?: Date;
  displayYears: { from: number; to: number };
  setDisplayYears: React.Dispatch<React.SetStateAction<{ from: number; to: number }>>;
  onPrevClick?: (date: Date) => void;
  onNextClick?: (date: Date) => void;
}) {
  const { nextMonth, previousMonth, goToMonth } = useDayPicker();

  const isPreviousDisabled = (() => {
    if (navView === NavView.Year) {
      return (
        (startMonth &&
          differenceInCalendarDays(new Date(displayYears.from - 1, 0, 1), startMonth) < 0) ||
        (endMonth && differenceInCalendarDays(new Date(displayYears.from - 1, 0, 1), endMonth) > 0)
      );
    }
    return !previousMonth;
  })();

  const isNextDisabled = (() => {
    if (navView === NavView.Year) {
      return (
        (startMonth &&
          differenceInCalendarDays(new Date(displayYears.to + 1, 0, 1), startMonth) < 0) ||
        (endMonth && differenceInCalendarDays(new Date(displayYears.to + 1, 0, 1), endMonth) > 0)
      );
    }
    return !nextMonth;
  })();

  const handlePreviousClick = React.useCallback(() => {
    if (!previousMonth) return;
    if (navView === NavView.Year) {
      setDisplayYears((prev) => ({
        from: prev.from - (prev.to - prev.from + 1),
        to: prev.to - (prev.to - prev.from + 1),
      }));
      onPrevClick?.(new Date(displayYears.from - (displayYears.to - displayYears.from), 0, 1));
      return;
    }
    goToMonth(previousMonth);
    onPrevClick?.(previousMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousMonth, goToMonth]);

  const handleNextClick = React.useCallback(() => {
    if (!nextMonth) return;
    if (navView === NavView.Year) {
      setDisplayYears((prev) => ({
        from: prev.from + (prev.to - prev.from + 1),
        to: prev.to + (prev.to - prev.from + 1),
      }));
      onNextClick?.(new Date(displayYears.from + (displayYears.to - displayYears.from), 0, 1));
      return;
    }
    goToMonth(nextMonth);
    onNextClick?.(nextMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToMonth, nextMonth]);
  return (
    <nav className={cn('flex items-center', className)}>
      <Button
        variant="outline"
        className="absolute left-0 h-7 w-7 bg-transparent p-0 opacity-80 hover:opacity-100"
        type="button"
        tabIndex={isPreviousDisabled ? undefined : -1}
        disabled={isPreviousDisabled}
        aria-label={
          navView === NavView.Year
            ? `Go to the previous ${displayYears.to - displayYears.from + 1} years`
            : labelPrevious(previousMonth)
        }
        onClick={handlePreviousClick}
      >
        <ChevronLeftIcon className="size-4" />
      </Button>

      <Button
        variant="outline"
        className="absolute right-0 h-7 w-7 bg-transparent p-0 opacity-80 hover:opacity-100"
        type="button"
        tabIndex={isNextDisabled ? undefined : -1}
        disabled={isNextDisabled}
        aria-label={
          navView === NavView.Year
            ? `Go to the next ${displayYears.to - displayYears.from + 1} years`
            : labelNext(nextMonth)
        }
        onClick={handleNextClick}
      >
        <ChevronRightIcon className="size-4" />
      </Button>
    </nav>
  );
}

function CaptionLabel({
  children,
  showYearSwitcher,
  navView,
  setNavView,
  displayYears,
  ...props
}: {
  showYearSwitcher?: boolean;
  navView: NavView;
  setNavView: React.Dispatch<React.SetStateAction<NavView>>;
  displayYears: { from: number; to: number };
} & React.HTMLAttributes<HTMLSpanElement>) {
  if (!showYearSwitcher) return <span {...props}>{children}</span>;
  return (
    <Button
      className="h-7 w-full truncate text-sm font-medium"
      variant="ghost"
      size="sm"
      onClick={() => setNavView((prev) => (prev === NavView.Day ? NavView.Year : NavView.Day))}
    >
      {navView === NavView.Day ? children : displayYears.from + ' - ' + displayYears.to}
    </Button>
  );
}

function MonthGrid({
  className,
  children,
  displayYears,
  startMonth,
  endMonth,
  navView,
  setNavView,
  ...props
}: {
  className?: string;
  children: React.ReactNode;
  displayYears: { from: number; to: number };
  startMonth?: Date;
  endMonth?: Date;
  navView: NavView;
  setNavView: React.Dispatch<React.SetStateAction<NavView>>;
} & React.TableHTMLAttributes<HTMLTableElement>) {
  if (navView === NavView.Year) {
    return (
      <YearGrid
        displayYears={displayYears}
        startMonth={startMonth}
        endMonth={endMonth}
        setNavView={setNavView}
        navView={navView}
        className={className}
        {...props}
      />
    );
  }
  return (
    <table className={className} {...props}>
      {children}
    </table>
  );
}

function YearGrid({
  className,
  displayYears,
  startMonth,
  endMonth,
  setNavView,
  navView,
  ...props
}: {
  className?: string;
  displayYears: { from: number; to: number };
  startMonth?: Date;
  endMonth?: Date;
  setNavView: React.Dispatch<React.SetStateAction<NavView>>;
  navView: NavView;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { goToMonth, selected } = useDayPicker();

  return (
    <div className={cn('grid grid-cols-4 gap-y-2', className)} {...props}>
      {Array.from({ length: displayYears.to - displayYears.from + 1 }, (_, i) => {
        const isBefore =
          differenceInCalendarDays(new Date(displayYears.from + i, 11, 31), startMonth!) < 0;

        const isAfter =
          differenceInCalendarDays(new Date(displayYears.from + i, 0, 0), endMonth!) > 0;

        const isDisabled = isBefore || isAfter;
        return (
          <Button
            key={i}
            className={cn(
              'h-7 w-full text-sm font-normal text-foreground',
              displayYears.from + i === new Date().getFullYear() &&
                'bg-accent font-medium text-accent-foreground'
            )}
            variant="ghost"
            onClick={() => {
              setNavView(NavView.Day);
              goToMonth(
                new Date(displayYears.from + i, (selected as Date | undefined)?.getMonth() ?? 0)
              );
            }}
            disabled={navView === NavView.Year ? isDisabled : undefined}
          >
            {displayYears.from + i}
          </Button>
        );
      })}
    </div>
  );
}

export { Calendar, CalendarDayButton };
