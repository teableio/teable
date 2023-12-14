import type { IDateTimeFieldOperator, IDateFilter, ITimeZoneString } from '@teable-group/core';
import { exactDate, FieldType, getValidFilterSubOperators } from '@teable-group/core';
import { Input } from '@teable-group/ui-lib';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DateField } from '../../../../model';
import { BaseSingleSelect } from '../base';
import {
  DATEPICKEROPTIONS,
  defaultValue,
  INPUTOPTIONS,
  withInDefaultValue,
  defaultMapping,
} from './constant';
import { DatePicker } from './DatePicker';

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
    (val: string) => {
      const mergedValue = {
        mode: exactDate.value,
        exactDate: val,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
      };
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
      label: defaultMapping[operator],
      value: operator,
    }));
    // change the operator to another type
    if (innerValue && !options.some((option) => option.value === innerValue?.mode)) {
      const newValue = { ...innerValue };
      newValue.mode = defaultConfig.mode;
      onSelect?.(newValue);
    }
    return options;
  }, [defaultConfig.mode, innerValue, onSelect, operator]);

  const inputCreator = useMemo(() => {
    const isDatePick = innerValue?.mode && DATEPICKEROPTIONS.includes(innerValue?.mode);
    const isInput = innerValue?.mode && INPUTOPTIONS.includes(innerValue?.mode);
    switch (true) {
      case isDatePick:
        return (
          <DatePicker value={innerValue?.exactDate} onSelect={datePickerSelect} field={field} />
        );
      case isInput:
        return (
          <Input
            placeholder="Enter days"
            defaultValue={innerValue?.numberOfDays ?? ''}
            className="m-1 h-8 w-24 placeholder:text-[13px]"
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
  }, [innerValue, datePickerSelect, field, onSelect]);

  return (
    <>
      <BaseSingleSelect
        options={selectOptions}
        onSelect={mergedOnSelect}
        value={innerValue?.mode || null}
        className="max-w-xs"
        popoverClassName="w-max"
      />
      {inputCreator}
    </>
  );
}

export { FilterDatePicker };
