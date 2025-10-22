import type {
  IDateTimeFieldOperator,
  IDateFilter,
  ITimeZoneString,
  ISubOperator,
} from '@teable/core';
import { exactDate, FieldType, getValidFilterSubOperators, isWithIn } from '@teable/core';
import { Input, cn } from '@teable/ui-lib';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../../../context/app/i18n';
import type { DateField } from '../../../../../model';
import { DateEditor } from '../../../../editor';
import { useDateI18nMap } from '../../hooks';
import { BaseSingleSelect } from '../base';
import { DATEPICKEROPTIONS, defaultValue, INPUTOPTIONS, withInDefaultValue } from './constant';

const isDateFilterEqual = (
  a: IDateFilter | null | undefined,
  b: IDateFilter | null | undefined
): boolean => {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.mode === b.mode &&
    a.exactDate === b.exactDate &&
    a.numberOfDays === b.numberOfDays &&
    a.timeZone === b.timeZone
  );
};

interface IFilerDatePickerProps {
  value: IDateFilter | null;
  field: DateField;
  operator: string;
  onSelect: (value: IDateFilter | null) => void;
  modal?: boolean;
  className?: string;
  onModeChange?: (mode: IDateFilter['mode'] | null) => void;
}

function FilterDatePicker(props: IFilerDatePickerProps) {
  const { value: initValue, operator, onSelect, field, modal, className, onModeChange } = props;
  const defaultConfig = operator === isWithIn.value ? withInDefaultValue : defaultValue;
  const [innerValue, setInnerValue] = useState<IDateFilter | null>(
    () => initValue ?? defaultConfig
  );
  const { t } = useTranslation();
  const dateMap = useDateI18nMap();

  const previousInitRef = useRef<IDateFilter | null>(initValue ?? null);

  useEffect(() => {
    const normalizedInit = initValue ?? null;
    const prev = previousInitRef.current;

    if (isDateFilterEqual(prev, normalizedInit)) {
      return;
    }

    previousInitRef.current = normalizedInit;

    if (normalizedInit) {
      setInnerValue(normalizedInit);
      onModeChange?.(normalizedInit.mode);
      return;
    }

    if (!innerValue) {
      setInnerValue(defaultConfig);
      onModeChange?.(defaultConfig.mode);
    }
  }, [defaultConfig, innerValue, initValue, onModeChange]);

  const mergedOnSelect = useCallback(
    (val: string | null) => {
      if (val === null) {
        setInnerValue(null);
        onModeChange?.(null);
        return;
      }

      const mergedValue = {
        mode: val as IDateFilter['mode'],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      setInnerValue(mergedValue as IDateFilter);
      onModeChange?.(val as IDateFilter['mode']);
      if (INPUTOPTIONS.includes(val)) {
        if (innerValue?.numberOfDays) {
          onSelect({ ...mergedValue, numberOfDays: innerValue.numberOfDays });
        }
        return;
      }

      if (DATEPICKEROPTIONS.includes(val)) {
        if (innerValue?.exactDate) {
          onSelect({ ...mergedValue, exactDate: innerValue.exactDate });
        }
        return;
      }

      onSelect(mergedValue as IDateFilter);
    },
    [innerValue?.exactDate, innerValue?.numberOfDays, onSelect]
  );

  const datePickerSelect = useCallback(
    (val: string | null | undefined, mode?: ISubOperator) => {
      const mergedValue = val
        ? {
            mode: mode || exactDate.value,
            exactDate: val,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
          }
        : null;
      onModeChange?.(mergedValue?.mode ?? null);
      onSelect?.(mergedValue);
    },
    [onModeChange, onSelect]
  );

  const selectOptions = useMemo(() => {
    const optionMapping = getValidFilterSubOperators(
      FieldType.Date,
      operator as IDateTimeFieldOperator
    );
    return optionMapping!.map((operator) => ({
      label: dateMap[operator],
      value: operator,
    }));
  }, [dateMap, operator]);

  const inputCreator = useMemo(() => {
    const isDatePick = innerValue?.mode && DATEPICKEROPTIONS.includes(innerValue?.mode);
    const isInput = innerValue?.mode && INPUTOPTIONS.includes(innerValue?.mode);
    switch (true) {
      case isDatePick:
        return (
          <DateEditor
            value={innerValue?.exactDate}
            onChange={(value) => datePickerSelect(value, innerValue?.mode)}
            options={field.options}
            disableTimePicker={true}
            className="h-9 w-40 text-xs sm:h-9"
          />
        );
      case isInput:
        return (
          <Input
            placeholder={t('filter.default.placeholder')}
            defaultValue={innerValue?.numberOfDays ?? ''}
            className="h-9 w-24 placeholder:text-xs"
            onInput={(e) => {
              // limit the number positive
              e.currentTarget.value = e.currentTarget.value?.replace(/\D/g, '');
            }}
            onChange={(e) => {
              const value = e.target.value;
              if (innerValue && value !== '') {
                const newValue: IDateFilter = { ...innerValue };
                newValue.numberOfDays = Number(value);
                onSelect?.(newValue);
              }
            }}
          />
        );
    }
    return null;
  }, [innerValue, datePickerSelect, field.options, t, onSelect]);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <BaseSingleSelect
        options={selectOptions}
        onSelect={mergedOnSelect}
        value={innerValue?.mode || null}
        className={cn('h-9 min-w-[8rem] flex-1', className)}
        popoverClassName="w-max"
        modal={modal}
      />
      {inputCreator}
    </div>
  );
}

export { FilterDatePicker };
