import type { IDateTimeFieldOperator, IDateFilter, ITimeZoneString } from '@teable/core';
import { exactDate, FieldType, getValidFilterSubOperators } from '@teable/core';
import { Input } from '@teable/ui-lib';
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isDateMetaValue = (value: any) => {
  return !!(value?.mode && value?.timeZone);
};

function FilterDatePicker(props: IFilerDatePickerProps) {
  const { value: initValue, operator, onSelect, field } = props;
  const [innerValue, setInnerValue] = useState<IDateFilter | null>(initValue);
  const { t } = useTranslation();
  const dateMap = useDateI18nMap();

  const defaultConfig = useMemo(() => {
    if (operator !== 'isWithIn') {
      return defaultValue;
    }
    return withInDefaultValue;
  }, [operator]);

  useEffect(() => {
    if (!initValue) {
      setInnerValue(defaultConfig);
    } else {
      setInnerValue(initValue);
    }

    if (!isDateMetaValue(initValue)) {
      onSelect(null);
    }
  }, [defaultConfig, initValue, onSelect]);

  const mergedOnSelect = useCallback(
    (val: string | null) => {
      const mergedValue = {
        mode: val as IDateFilter['mode'],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      setInnerValue(mergedValue as IDateFilter);
      if (val !== null && !INPUTOPTIONS.includes(val) && !DATEPICKEROPTIONS.includes(val)) {
        onSelect?.(mergedValue as IDateFilter);
      }
    },
    [onSelect]
  );

  const datePickerSelect = useCallback(
    (val: string | null | undefined) => {
      const mergedValue = val
        ? {
            mode: exactDate.value,
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const options = optionMapping!.map((operator) => ({
      label: dateMap[operator],
      value: operator,
    }));
    // change the operator to another type
    if (innerValue && !options.some((option) => option.value === innerValue?.mode)) {
      const newValue = { ...innerValue };
      newValue.mode = defaultConfig.mode;
      onSelect?.(newValue);
    }
    return options;
  }, [dateMap, defaultConfig.mode, innerValue, onSelect, operator]);

  const inputCreator = useMemo(() => {
    const isDatePick = innerValue?.mode && DATEPICKEROPTIONS.includes(innerValue?.mode);
    const isInput = innerValue?.mode && INPUTOPTIONS.includes(innerValue?.mode);
    switch (true) {
      case isDatePick:
        return (
          <DateEditor
            value={innerValue?.exactDate}
            onChange={datePickerSelect}
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
            className="h-8 w-24 placeholder:text-[13px]"
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
    <div className="flex gap-2">
      <BaseSingleSelect
        options={selectOptions}
        onSelect={mergedOnSelect}
        value={innerValue?.mode || null}
        className="max-w-xs"
        popoverClassName="w-max"
      />
      {inputCreator}
    </div>
  );
}

export { FilterDatePicker };
