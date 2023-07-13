import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { useMemo, useCallback, useState, useEffect } from 'react';
import { BaseSingleSelect } from '../BaseSingleSelect';
import {
  defaultMapping,
  withinMapping,
  DATEPICKEROPTIONS,
  INPUTOPTIONS,
  defaultValue,
  withInDefaultValue,
} from './constant';
import { DatePicker } from './DatePicker';

interface IDateValue {
  mode: string | null;
  exactDate?: string | null;
  numberOfDays?: string;
  timeZone?: string;
}
interface IFilerDatePickerProps {
  value: IDateValue | null;
  operator: string;
  onSelect: (value: IDateValue | null) => void;
}

function FilterDatePicker(props: IFilerDatePickerProps) {
  const { value: initValue, operator, onSelect } = props;
  const [innerValue, setInnerValue] = useState<IDateValue | null>(initValue);

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
        mode: val,
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
        mode: 'exactDate',
        exactDate: val,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      onSelect?.(mergedValue);
    },
    [onSelect]
  );

  const selectOptions = useMemo(() => {
    const optionMapping = operator === 'isWithIn' ? withinMapping : defaultMapping;
    const options = [];
    for (const [key, value] of Object.entries(optionMapping)) {
      options.push({
        label: value,
        value: key,
      });
    }
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
            className="w-24 m-1"
            value={innerValue?.numberOfDays || ''}
            onChange={(e) => {
              const newValue: IDateValue = innerValue
                ? { ...innerValue }
                : {
                    mode: null,
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  };
              newValue.numberOfDays = e.target.value;
              onSelect?.(newValue);
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
