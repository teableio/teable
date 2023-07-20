import type { IDateTimeFieldOperator, IFilterMetaValueByDate } from '@teable-group/core';
import { exactDate, FieldType, getValidFilterSubOperators } from '@teable-group/core';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BaseSingleSelect } from '../BaseSingleSelect';
import { DATEPICKEROPTIONS, defaultValue, INPUTOPTIONS, withInDefaultValue } from './constant';
import { DatePicker } from './DatePicker';

interface IFilerDatePickerProps {
  value: IFilterMetaValueByDate | null;
  operator: string;
  onSelect: (value: IFilterMetaValueByDate | null) => void;
}

function FilterDatePicker(props: IFilerDatePickerProps) {
  const { value: initValue, operator, onSelect } = props;
  const [innerValue, setInnerValue] = useState<IFilterMetaValueByDate | null>(initValue);

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
  }, [defaultConfig, initValue]);

  const mergedOnSelect = useCallback(
    (val: string) => {
      const mergedValue = {
        mode: val as IFilterMetaValueByDate['mode'],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      setInnerValue(mergedValue);
      if (!INPUTOPTIONS.includes(val) && !DATEPICKEROPTIONS.includes(val)) {
        onSelect?.(mergedValue);
      }
    },
    [onSelect]
  );

  const datePickerSelect = useCallback(
    (val: string) => {
      const mergedValue = {
        mode: exactDate.value,
        exactDate: val,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
    const options = optionMapping!.map((operator) => ({
      label: operator,
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
        return <DatePicker value={innerValue?.exactDate} onSelect={datePickerSelect} />;
      case isInput:
        return (
          <Input
            placeholder="Enter days"
            defaultValue={innerValue?.numberOfDays ?? ''}
            className="w-24 m-1"
            onInput={(e) => {
              // limit the number positive
              e.currentTarget.value = e.currentTarget.value?.replace(/\D/g, '');
            }}
            onChange={(e) => {
              const value = e.target.value;
              if (innerValue && value !== '') {
                const newValue: IFilterMetaValueByDate = { ...innerValue };
                newValue.numberOfDays = Number(value);
                onSelect?.(newValue);
              }
            }}
          />
        );
    }
    return null;
  }, [datePickerSelect, onSelect, innerValue]);

  return (
    <>
      <BaseSingleSelect
        options={selectOptions}
        onSelect={mergedOnSelect}
        value={innerValue?.mode || null}
        classNames="w-52 w-m-52"
        popoverClassNames="w-max"
      />
      {inputCreator}
    </>
  );
}

FilterDatePicker.displayName = 'FilterDatePicker';

export { FilterDatePicker };
