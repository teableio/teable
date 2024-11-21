import { type IDateFieldOptions, TimeFormatting } from '@teable/core';
import { Button, Calendar, Input } from '@teable/ui-lib';
import { enUS, zhCN } from 'date-fns/locale';
import { formatInTimeZone, toDate, utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useContext, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AppContext } from '../../../context';
import { useTranslation } from '../../../context/app/i18n';
import type { ICellEditor, IEditorRef } from '../type';

export interface IDateEditorMain extends ICellEditor<string | null> {
  style?: React.CSSProperties;
  options?: IDateFieldOptions;
  disableTimePicker?: boolean;
}

const LOCAL_MAP = {
  zh: zhCN,
  en: enUS,
};

const DateEditorMainBase: ForwardRefRenderFunction<IEditorRef<string>, IDateEditorMain> = (
  props,
  ref
) => {
  const { value, style, className, onChange, readonly, options, disableTimePicker = false } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { time, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } =
    options?.formatting || {};
  const [date, setDate] = useState<string | null>(value || null);
  const notHaveTimePicker = disableTimePicker || time === TimeFormatting.None;
  const defaultFocusRef = useRef<HTMLInputElement | null>(null);
  const { lang = 'en' } = useContext(AppContext);
  const { t } = useTranslation();

  useImperativeHandle(ref, () => ({
    focus: () => defaultFocusRef.current?.focus?.(),
    setValue: (value?: string) => setDate(value || null),
    saveValue,
  }));

  const onSelect = (value?: Date) => {
    if (!value) return onChange?.(null);

    const curDatetime = zonedTimeToUtc(value, timeZone);

    if (date) {
      const prevDatetime = toDate(date, { timeZone });

      curDatetime.setHours(prevDatetime.getHours());
      curDatetime.setMinutes(prevDatetime.getMinutes());
      curDatetime.setSeconds(prevDatetime.getSeconds());
    } else {
      const tempDate = now();

      curDatetime.setHours(tempDate.getHours());
      curDatetime.setMinutes(tempDate.getMinutes());
      curDatetime.setSeconds(tempDate.getSeconds());
    }

    const dateStr = curDatetime.toISOString();
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

    return utcToZonedTime(date, timeZone);
  }, [date, timeZone]);

  const onTimeChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    if (!date) return;
    const datetime = utcToZonedTime(date, timeZone);
    const timeValue = e.target.value;

    const hours = Number.parseInt(timeValue.split(':')[0] || '00', 10);
    const minutes = Number.parseInt(timeValue.split(':')[1] || '00', 10);

    datetime.setHours(hours);
    datetime.setMinutes(minutes);

    setDate(zonedTimeToUtc(datetime, timeZone).toISOString());
  };

  const saveValue = (nowDate?: string) => {
    const val = nowDate || date;

    if (value == val) return;
    setDate(val);
    onChange?.(val);
  };

  const now = () => {
    return zonedTimeToUtc(new Date(), timeZone);
  };

  return (
    <>
      <Calendar
        locale={LOCAL_MAP[lang as keyof typeof LOCAL_MAP]}
        style={style}
        mode="single"
        selected={selectedDate}
        defaultMonth={selectedDate}
        onSelect={onSelect}
        className={className}
        disabled={readonly}
        footer={
          <div className="flex items-center justify-center p-1">
            {!notHaveTimePicker && date ? (
              <Input
                className="mr-3 w-7/12"
                ref={inputRef}
                type="time"
                value={timeValue}
                onChange={onTimeChange}
                onBlur={() => saveValue()}
              />
            ) : null}
            <Button
              className="h-[34px] w-2/5 text-sm"
              size="sm"
              onClick={() => {
                saveValue(now().toISOString());
              }}
            >
              {t('editor.date.today')}
            </Button>
          </div>
        }
      />
      <input className="size-0 opacity-0" ref={defaultFocusRef} />
    </>
  );
};

export const DateEditorMain = forwardRef(DateEditorMainBase);
