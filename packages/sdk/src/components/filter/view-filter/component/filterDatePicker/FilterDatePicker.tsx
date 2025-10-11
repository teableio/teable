import type {
  IDateTimeFieldOperator,
  IDateFilter,
  ITimeZoneString,
  ISubOperator,
} from '@teable/core';
import { exactDate, FieldType, getValidFilterSubOperators, isWithIn } from '@teable/core';
import { Input, cn } from '@teable/ui-lib';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../../../context/app/i18n';
import type { DateField } from '../../../../../model';
import { DateEditor } from '../../../../editor';
import { useDateI18nMap } from '../../hooks';
import { BaseSingleSelect } from '../base';
import { DATEPICKEROPTIONS, defaultValue, INPUTOPTIONS, withInDefaultValue } from './constant';

interface IFilerDatePickerProps {
  value: IDateFilter | null;
  field: DateField;
  operator: string;
  onSelect: (value: IDateFilter | null) => void;
  modal?: boolean;
  className?: string;
}

function FilterDatePicker(props: IFilerDatePickerProps) {
  const { value: initValue, operator, onSelect, field, modal, className } = props;
  const [innerValue, setInnerValue] = useState<IDateFilter | null>(initValue);
  const { t } = useTranslation();
  const dateMap = useDateI18nMap();

  const defaultConfig = useMemo(() => {
    if (operator !== isWithIn.value) {
      return defaultValue;
    }
    return withInDefaultValue;
  }, [operator]);

  useEffect(() => {
    // according to the operator to get the default value
    if (initValue) {
      setInnerValue(initValue);
    } else {
      setInnerValue(defaultConfig);
    }
  }, [defaultConfig, initValue, operator]);

  const mergedOnSelect = useCallback(
    (val: string | null) => {
      const mergedValue = {
        mode: val as IDateFilter['mode'],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      setInnerValue(mergedValue as IDateFilter);
      if (val === null) {
        return;
      }
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
      onSelect?.(mergedValue);
    },
    [onSelect]
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
            className="h-8 w-40 text-xs sm:h-8"
          />
        );
      case isInput:
        return (
          <Input
            placeholder={t('filter.default.placeholder')}
            defaultValue={innerValue?.numberOfDays ?? ''}
            className="h-8 w-24 placeholder:text-xs"
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
    <div className={cn('flex gap-2', className)}>
      <BaseSingleSelect
        options={selectOptions}
        onSelect={mergedOnSelect}
        value={innerValue?.mode || null}
        className="max-w-xs"
        popoverClassName="w-max"
        modal={modal}
      />
      {inputCreator}
    </div>
  );
}

export { FilterDatePicker };
