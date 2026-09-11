import { type IDateFieldOptions, TimeFormatting } from '@teable/core';
import { Button, Calendar, cn, NavView } from '@teable/ui-lib';
import { ar, de, enUS, es, fr, he, it, ja, ru, tr, uk, zhCN } from 'date-fns/locale';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useContext, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AppContext } from '../../../context';
import { useTranslation } from '../../../context/app/i18n';
import type { ICellEditor, IEditorRef } from '../type';
import { TimePicker } from './TimePicker';

export interface IDateEditorMain extends ICellEditor<string | null> {
  style?: React.CSSProperties;
  options?: IDateFieldOptions;
  disableTimePicker?: boolean;
  /**
   * Radix `modal` for the calendar popover. Set it when this editor is
   * rendered inside a modal container (dialog/drawer), so the popover joins
   * the same dismissable layer instead of closing its parent on outside tap.
   */
  modal?: boolean;
}

// Remember to update in @nextjs-app/src/features/app/blocks/view/calendar/components/Calendar.tsx
const LOCAL_MAP = {
  zh: zhCN,
  en: enUS,
  ja: ja,
  ru: ru,
  fr: fr,
  de: de,
  es: es,
  it: it,
  tr: tr,
  uk: uk,
  ar: ar,
  he: he,
};

const DateEditorMainBase: ForwardRefRenderFunction<IEditorRef<string>, IDateEditorMain> = (
  props,
  ref
) => {
  const { value, style, className, onChange, readonly, options, disableTimePicker = false } = props;
  const { time, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } =
    options?.formatting || {};
  const [date, _setDate] = useState<string | null>(value || null);
  const dateRef = useRef<string | null>(value || null);
  const setDate = (val: string | null) => {
    dateRef.current = val;
    _setDate(val);
  };
  const [navView, setNavView] = useState<NavView>(NavView.Day);
  const [displayMonth, setDisplayMonth] = useState<Date | undefined>(() =>
    value ? toZonedTime(value, timeZone) : undefined
  );
  const notHaveTimePicker = disableTimePicker || time === TimeFormatting.None;
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const defaultFocusRef = useRef<HTMLInputElement | null>(null);
  const { lang = 'en' } = useContext(AppContext);
  const { t } = useTranslation();

  useImperativeHandle(ref, () => ({
    focus: () => defaultFocusRef.current?.focus?.(),
    setValue: (value?: string) => {
      setDate(value || null);
      setDisplayMonth(value ? toZonedTime(value, timeZone) : undefined);
    },
    saveValue,
  }));

  // The calendar hands over a day on the clock of timeZone; it keeps the time the value shows there.
  const onSelect = (value?: Date) => {
    if (!value) return onChange?.(null);

    const clock = toZonedTime(date ?? new Date(), timeZone);
    const datetime = new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      clock.getHours(),
      clock.getMinutes(),
      clock.getSeconds()
    );

    const dateStr = fromZonedTime(datetime, timeZone).toISOString();
    setDate(dateStr);
    onChange?.(dateStr);
  };

  const timeValue = useMemo(() => {
    if (!date) return '';
    return formatInTimeZone(date, timeZone, 'HH:mm');
  }, [date, timeZone]);

  const selectedDate = useMemo(() => {
    if (!date) {
      return;
    }

    return toZonedTime(date, timeZone);
  }, [date, timeZone]);

  const onTimeChange = (timeStr: string) => {
    const datetime = toZonedTime(date ?? new Date(), timeZone);

    const hours = Number.parseInt(timeStr.split(':')[0] || '00', 10);
    const minutes = Number.parseInt(timeStr.split(':')[1] || '00', 10);

    datetime.setHours(hours);
    datetime.setMinutes(minutes);

    const dateStr = fromZonedTime(datetime, timeZone).toISOString();
    setDate(dateStr);
    onChange?.(dateStr);
  };

  const saveValue = (nowDate?: string) => {
    const val = nowDate || dateRef.current;

    if (value == val) return;
    setDate(val);
    onChange?.(val);
  };

  const defaultTimeValue = useMemo(
    () => formatInTimeZone(new Date(), timeZone, 'HH:mm'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeZone]
  );

  const closeTimePicker = (e: React.MouseEvent) => {
    if (timePickerOpen) {
      e.stopPropagation();
      setTimePickerOpen(false);
    }
  };

  return (
    <div role="presentation" onMouseDown={closeTimePicker}>
      <Calendar
        locale={LOCAL_MAP[lang as keyof typeof LOCAL_MAP]}
        style={style}
        mode="single"
        timeZone={timeZone}
        selected={selectedDate}
        month={displayMonth}
        onMonthChange={setDisplayMonth}
        onSelect={onSelect}
        className={className}
        disabled={readonly}
        footer={
          <div
            className={cn(
              'flex items-center mt-1.5',
              notHaveTimePicker || !date ? 'justify-center' : 'justify-between',
              navView === NavView.Year && 'hidden'
            )}
          >
            {!notHaveTimePicker && date ? (
              <TimePicker
                value={timeValue}
                defaultValue={defaultTimeValue}
                open={timePickerOpen}
                onOpenChange={setTimePickerOpen}
                onChange={onTimeChange}
              />
            ) : null}
            <Button
              className="h-[34px] text-sm"
              variant="outline"
              size="sm"
              onClick={() => {
                const todayZoned = toZonedTime(new Date(), timeZone);
                if (date) {
                  // Preserve existing time, only change the date part
                  const existingZoned = toZonedTime(date, timeZone);
                  todayZoned.setHours(existingZoned.getHours());
                  todayZoned.setMinutes(existingZoned.getMinutes());
                  todayZoned.setSeconds(existingZoned.getSeconds());
                }
                saveValue(fromZonedTime(todayZoned, timeZone).toISOString());
              }}
            >
              {t('editor.date.today')}
            </Button>
          </div>
        }
        onNavViewChange={(navView) => setNavView(navView)}
      />
      <input className="absolute size-0 opacity-0" ref={defaultFocusRef} />
    </div>
  );
};

export const DateEditorMain = forwardRef(DateEditorMainBase);
