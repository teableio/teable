import type { IRollupFieldOptions, IUnionFormatting, IUnionShowAs } from '@teable/core';
import {
  assertNever,
  ROLLUP_FUNCTIONS,
  CellValueType,
  getDefaultFormatting,
  getFormattingSchema,
  getShowAsSchema,
} from '@teable/core';
import { BaseSingleSelect } from '@teable/sdk/components/filter/view-filter/component/base/BaseSingleSelect';

import { RollupField } from '@teable/sdk/model';
import { isEmpty, isEqual } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo } from 'react';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { TimeZoneFormatting } from '../formatting/TimeZoneFormatting';
import { UnionFormatting } from '../formatting/UnionFormatting';
import { UnionShowAs } from '../show-as/UnionShowAs';

const calculateRollupTypedValue = (
  expression?: string,
  cellValueType: CellValueType = CellValueType.String,
  isMultipleCellValue: boolean = false
) => {
  const defaultResult = {
    cellValueType: cellValueType,
    isMultipleCellValue: isMultipleCellValue,
  };

  try {
    return expression
      ? RollupField.getParsedValueType(expression, cellValueType, isMultipleCellValue)
      : defaultResult;
  } catch (e) {
    return defaultResult;
  }
};

export const RollupOptions = (props: {
  options: Partial<IRollupFieldOptions> | undefined;
  cellValueType?: CellValueType;
  isMultipleCellValue?: boolean;
  isLookup?: boolean;
  onChange?: (options: Partial<IRollupFieldOptions>) => void;
}) => {
  const {
    options = {},
    isLookup,
    cellValueType = CellValueType.String,
    isMultipleCellValue,
    onChange,
  } = props;
  const { expression, formatting, showAs } = options;
  const { t } = useTranslation(['table']);

  const typedValue = useMemo(
    () =>
      isLookup
        ? { cellValueType, isMultipleCellValue }
        : calculateRollupTypedValue(expression, cellValueType, isMultipleCellValue),
    [expression, cellValueType, isMultipleCellValue, isLookup]
  );

  const onExpressionChange = useCallback(
    (expr: IRollupFieldOptions['expression']) => {
      const { cellValueType: newCellValueType } = isLookup
        ? { cellValueType }
        : calculateRollupTypedValue(expr, cellValueType, isMultipleCellValue);
      const newOptions: IRollupFieldOptions = {
        expression: expr,
        timeZone:
          formatting && 'timeZone' in formatting && formatting?.timeZone
            ? formatting.timeZone
            : options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      if (newCellValueType !== cellValueType) {
        const defaultFormatting = getDefaultFormatting(newCellValueType);
        newOptions.formatting = defaultFormatting;
        newOptions.showAs = undefined;
      }
      onChange?.(newOptions);
    },
    [cellValueType, formatting, isMultipleCellValue, isLookup, options.timeZone, onChange]
  );

  const onFormattingChange = useCallback(
    (newFormatting?: IUnionFormatting) => {
      const { cellValueType } = typedValue;
      const formattingResult = getFormattingSchema(cellValueType).safeParse(newFormatting);
      const formattingParsed = formattingResult.success ? formattingResult.data : undefined;

      if (isEqual(formattingParsed, formatting)) {
        return;
      }
      onChange?.({ formatting: isEmpty(formattingParsed) ? undefined : newFormatting });
    },
    [formatting, onChange, typedValue]
  );

  const setTimeZone = useCallback(
    (newTimeZone: string) => {
      if (newTimeZone === options.timeZone) {
        return;
      }
      onChange?.({ timeZone: newTimeZone });
    },
    [options.timeZone, onChange]
  );

  const onShowAsChange = useCallback(
    (newShowAs?: IUnionShowAs) => {
      const { cellValueType, isMultipleCellValue } = typedValue;
      const showAsResult = getShowAsSchema(cellValueType, isMultipleCellValue).safeParse(newShowAs);
      const showAsParsed = showAsResult.success ? showAsResult.data : undefined;

      if (isEqual(showAsParsed, showAs)) {
        return;
      }
      onChange?.({ showAs: isEmpty(showAsParsed) ? undefined : newShowAs });
    },
    [showAs, onChange, typedValue]
  );

  const candidates = useMemo(() => {
    return ROLLUP_FUNCTIONS.map((f) => {
      let name;
      let description;
      switch (f) {
        case 'countall({values})':
          name = t('field.default.rollup.func.countAll');
          description = t('field.default.rollup.funcDesc.countAll');
          break;
        case 'counta({values})':
          name = t('field.default.rollup.func.countA');
          description = t('field.default.rollup.funcDesc.countA');
          break;
        case 'count({values})':
          name = t('field.default.rollup.func.count');
          description = t('field.default.rollup.funcDesc.count');
          break;
        case 'sum({values})':
          name = t('field.default.rollup.func.sum');
          description = t('field.default.rollup.funcDesc.sum');
          break;
        case 'max({values})':
          name = t('field.default.rollup.func.max');
          description = t('field.default.rollup.funcDesc.max');
          break;
        case 'min({values})':
          name = t('field.default.rollup.func.min');
          description = t('field.default.rollup.funcDesc.min');
          break;
        case 'and({values})':
          name = t('field.default.rollup.func.and');
          description = t('field.default.rollup.funcDesc.and');
          break;
        case 'or({values})':
          name = t('field.default.rollup.func.or');
          description = t('field.default.rollup.funcDesc.or');
          break;
        case 'xor({values})':
          name = t('field.default.rollup.func.xor');
          description = t('field.default.rollup.funcDesc.xor');
          break;
        case 'array_join({values})':
          name = t('field.default.rollup.func.arrayJoin');
          description = t('field.default.rollup.funcDesc.arrayJoin');
          break;
        case 'array_unique({values})':
          name = t('field.default.rollup.func.arrayUnique');
          description = t('field.default.rollup.funcDesc.arrayUnique');
          break;
        case 'array_compact({values})':
          name = t('field.default.rollup.func.arrayCompact');
          description = t('field.default.rollup.funcDesc.arrayCompact');
          break;
        case 'concatenate({values})':
          name = t('field.default.rollup.func.concatenate');
          description = t('field.default.rollup.funcDesc.concatenate');
          break;
        default:
          assertNever(f);
      }
      return {
        value: f,
        label: name,
        description,
      };
    });
  }, [t]);

  const displayRender = (option: (typeof candidates)[number]) => {
    const { label } = option;
    return (
      <div className="flex items-center justify-start">
        <div>
          <div className="truncate pl-1 text-[13px]">{label}</div>
        </div>
      </div>
    );
  };

  const optionRender = (option: (typeof candidates)[number]) => {
    const { label, description } = option;
    return (
      <div className="flex items-start justify-start">
        <div className="pl-1">
          <div className="truncate text-[13px]">{label}</div>
          <span className="text-wrap text-xs text-primary/60" title={description}>
            {description}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className=" w-full space-y-4 border-t pt-4" data-testid="rollup-options">
      {!isLookup && (
        <div className="space-y-2">
          <span className="neutral-content text-sm font-medium">
            {t('field.default.rollup.rollup')}
            <RequireCom />
          </span>
          <BaseSingleSelect
            modal
            className="h-9 w-full"
            placeholder={t('field.default.rollup.selectAnRollupFunction')}
            options={candidates}
            value={expression || null}
            onSelect={(id) => {
              onExpressionChange(id as IRollupFieldOptions['expression']);
            }}
            optionRender={optionRender}
            displayRender={displayRender}
          />
        </div>
      )}
      {(isLookup || Boolean(expression)) && (
        <>
          <div className="space-y-2">
            <UnionFormatting
              cellValueType={typedValue.cellValueType}
              formatting={formatting}
              onChange={onFormattingChange}
            />
          </div>
          {!isLookup && cellValueType !== CellValueType.DateTime && (
            <TimeZoneFormatting
              timeZone={options?.timeZone}
              onChange={(value) => setTimeZone(value)}
            />
          )}
          <div className="space-y-2">
            <UnionShowAs
              showAs={options?.showAs}
              cellValueType={typedValue.cellValueType}
              isMultipleCellValue={typedValue.isMultipleCellValue}
              onChange={onShowAsChange}
            />
          </div>
        </>
      )}
    </div>
  );
};
