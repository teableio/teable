import type {
  IDateTimeFieldOperator,
  IDateFilter,
  ITimeZoneString,
  ISubOperator,
} from '@teable/core';
import {
  dateRange,
  exactDate,
  FieldType,
  getValidFilterSubOperators,
  isWithIn,
} from '@teable/core';
import { Input, cn } from '@teable/ui-lib';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../../../context/app/i18n';
import type { DateField } from '../../../../../model';
import { DateEditor } from '../../../../editor';
import { useDateI18nMap } from '../../hooks';
import { BaseSingleSelect } from '../base';
import {
  DATEPICKEROPTIONS,
  DATERANGEOPTIONS,
  defaultValue,
  HIDDEN_DATE_MODES,
  INPUTOPTIONS,
  withInDefaultValue,
} from './constant';
import { DateRangePicker } from './DateRangePicker';

const NON_DIGIT_REGEX = /\D/g;

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
    a.exactDateEnd === b.exactDateEnd &&
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

interface IDatePickerInputProps {
  innerValue: IDateFilter | null;
  datePickerSelect: (val: string | null | undefined, mode?: ISubOperator) => void;
  fieldOptions: DateField['options'];
}

const DatePickerInput = memo(function DatePickerInput({
  innerValue,
  datePickerSelect,
  fieldOptions,
}: IDatePickerInputProps) {
  const handleChange = useCallback(
    (value: string | null | undefined) => datePickerSelect(value, innerValue?.mode),
    [datePickerSelect, innerValue?.mode]
  );

  return (
    <DateEditor
      value={innerValue?.exactDate}
      onChange={handleChange}
      options={fieldOptions}
      disableTimePicker={true}
      className="h-8 w-40 text-xs"
    />
  );
});

interface IDateRangeInputProps {
  innerValue: IDateFilter | null;
  dateRangeSelect: (
    val: { exactDate?: string; exactDateEnd?: string; timeZone: ITimeZoneString } | null
  ) => void;
  fieldOptions: DateField['options'];
}

const DateRangeInput = memo(function DateRangeInput({
  innerValue,
  dateRangeSelect,
  fieldOptions,
}: IDateRangeInputProps) {
  const rangeValue = useMemo(
    () =>
      innerValue?.exactDate
        ? {
            exactDate: innerValue.exactDate,
            exactDateEnd: innerValue.exactDateEnd,
            timeZone: innerValue.timeZone,
          }
        : null,
    [innerValue?.exactDate, innerValue?.exactDateEnd, innerValue?.timeZone]
  );

  return (
    <DateRangePicker
      value={rangeValue}
      onChange={dateRangeSelect}
      options={fieldOptions}
      className="text-xs"
    />
  );
});

interface INumberInputProps {
  innerValue: IDateFilter | null;
  onSelect: (value: IDateFilter | null) => void;
}

const NumberInput = memo(function NumberInput({ innerValue, onSelect }: INumberInputProps) {
  const { t } = useTranslation();

  const handleInput = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    e.currentTarget.value = e.currentTarget.value?.replace(NON_DIGIT_REGEX, '');
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (innerValue && value !== '') {
        onSelect({ ...innerValue, numberOfDays: Number(value) });
      }
    },
    [innerValue, onSelect]
  );

  return (
    <Input
      placeholder={t('filter.default.placeholder')}
      defaultValue={innerValue?.numberOfDays ?? ''}
      className="h-8 w-24 placeholder:text-xs"
      onInput={handleInput}
      onChange={handleChange}
    />
  );
});

function FilterDatePicker(props: IFilerDatePickerProps) {
  const { value: initValue, operator, onSelect, field, modal, className, onModeChange } = props;
  const defaultConfig = operator === isWithIn.value ? withInDefaultValue : defaultValue;
  const [innerValue, setInnerValue] = useState<IDateFilter | null>(
    () => initValue ?? defaultConfig
  );
  const dateMap = useDateI18nMap();

  const previousInitRef = useRef<IDateFilter | null>(initValue ?? null);
  const previousOperatorRef = useRef<string>(operator);
  const onModeChangeRef = useRef(onModeChange);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onModeChangeRef.current = onModeChange;
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    const normalizedInit = initValue ?? null;
    const prev = previousInitRef.current;
    const operatorChanged = previousOperatorRef.current !== operator;

    // Update refs
    previousInitRef.current = normalizedInit;
    previousOperatorRef.current = operator;

    // When operator changes
    if (operatorChanged) {
      // Check if current mode is valid for the new operator
      const validSubOperators = getValidFilterSubOperators(
        FieldType.Date,
        operator as IDateTimeFieldOperator
      );
      const currentModeValid =
        normalizedInit?.mode && validSubOperators?.includes(normalizedInit.mode);

      if (!currentModeValid) {
        // Reset to default config when mode is invalid for new operator
        setInnerValue(defaultConfig);
        onModeChangeRef.current?.(defaultConfig.mode);
        // Also reset external value (e.g., dateRange is only valid for 'is')
        if (normalizedInit?.mode) {
          onSelectRef.current(null);
        }
      }
      // Otherwise keep the current value (mode and date value preserved)
      return;
    }

    if (isDateFilterEqual(prev, normalizedInit)) {
      return;
    }

    if (normalizedInit) {
      setInnerValue(normalizedInit);
      onModeChangeRef.current?.(normalizedInit.mode);
      return;
    }

    // When initValue becomes null, reset to default config
    setInnerValue(defaultConfig);
    onModeChangeRef.current?.(defaultConfig.mode);
  }, [defaultConfig, initValue, operator]);

  const mergedOnSelect = useCallback((val: string | null) => {
    if (val === null) {
      setInnerValue(null);
      onModeChangeRef.current?.(null);
      return;
    }

    setInnerValue((currentValue) => {
      if (val === currentValue?.mode) {
        return currentValue;
      }

      const mergedValue = {
        mode: val as IDateFilter['mode'],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      onModeChangeRef.current?.(val as IDateFilter['mode']);

      if (INPUTOPTIONS.includes(val)) {
        if (currentValue?.numberOfDays) {
          onSelectRef.current({ ...mergedValue, numberOfDays: currentValue.numberOfDays });
        }
        return mergedValue as IDateFilter;
      }

      if (DATEPICKEROPTIONS.includes(val)) {
        if (currentValue?.exactDate) {
          onSelectRef.current({ ...mergedValue, exactDate: currentValue.exactDate });
        }
        return mergedValue as IDateFilter;
      }

      if (DATERANGEOPTIONS.includes(val)) {
        if (currentValue?.exactDate && currentValue?.exactDateEnd) {
          onSelectRef.current({
            ...mergedValue,
            exactDate: currentValue.exactDate,
            exactDateEnd: currentValue.exactDateEnd,
          });
        }
        return mergedValue as IDateFilter;
      }

      onSelectRef.current(mergedValue as IDateFilter);
      return mergedValue as IDateFilter;
    });
  }, []);

  const datePickerSelect = useCallback((val: string | null | undefined, mode?: ISubOperator) => {
    const mergedValue = val
      ? {
          mode: mode || exactDate.value,
          exactDate: val,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
        }
      : null;
    onModeChangeRef.current?.(mergedValue?.mode ?? null);
    onSelectRef.current?.(mergedValue);
  }, []);

  const dateRangeSelect = useCallback(
    (val: { exactDate?: string; exactDateEnd?: string; timeZone: ITimeZoneString } | null) => {
      if (!val || !val.exactDate || !val.exactDateEnd) {
        // Don't clear the filter when partially selected
        return;
      }
      const mergedValue: IDateFilter = {
        mode: dateRange.value,
        exactDate: val.exactDate,
        exactDateEnd: val.exactDateEnd,
        timeZone: val.timeZone,
      };
      onModeChangeRef.current?.(mergedValue.mode);
      onSelectRef.current?.(mergedValue);
    },
    []
  );

  const selectOptions = useMemo(() => {
    const optionMapping = getValidFilterSubOperators(
      FieldType.Date,
      operator as IDateTimeFieldOperator
    );
    return optionMapping!
      .filter((op) => !HIDDEN_DATE_MODES.includes(op))
      .map((op) => ({
        label: dateMap[op],
        value: op,
      }));
  }, [dateMap, operator]);

  // Show current value label even if it's a hidden option (for backwards compatibility)
  const currentValueLabel = useMemo(() => {
    const currentMode = innerValue?.mode;
    if (currentMode && HIDDEN_DATE_MODES.includes(currentMode)) {
      return dateMap[currentMode];
    }
    return undefined;
  }, [innerValue?.mode, dateMap]);

  const renderInputComponent = () => {
    const mode = innerValue?.mode;
    if (!mode) return null;

    if (DATEPICKEROPTIONS.includes(mode)) {
      return (
        <DatePickerInput
          innerValue={innerValue}
          datePickerSelect={datePickerSelect}
          fieldOptions={field.options}
        />
      );
    }

    if (DATERANGEOPTIONS.includes(mode)) {
      return (
        <DateRangeInput
          innerValue={innerValue}
          dateRangeSelect={dateRangeSelect}
          fieldOptions={field.options}
        />
      );
    }

    if (INPUTOPTIONS.includes(mode)) {
      return <NumberInput innerValue={innerValue} onSelect={onSelect} />;
    }

    return null;
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <BaseSingleSelect
        options={selectOptions}
        onSelect={mergedOnSelect}
        value={innerValue?.mode || null}
        defaultLabel={currentValueLabel}
        className={cn('h-8 min-w-[8rem] flex-1', className)}
        popoverClassName="w-max"
        modal={modal}
      />
      {renderInputComponent()}
    </div>
  );
}

export { FilterDatePicker };
