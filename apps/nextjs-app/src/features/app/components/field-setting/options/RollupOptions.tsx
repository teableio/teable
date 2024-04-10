import type { IRollupFieldOptions, IUnionFormatting, IUnionShowAs } from '@teable/core';
import {
  assertNever,
  ROLLUP_FUNCTIONS,
  CellValueType,
  getDefaultFormatting,
  getFormattingSchema,
  getShowAsSchema,
} from '@teable/core';
import { RollupField } from '@teable/sdk/model';
import { Selector } from '@teable/ui-lib/base';
import { isEmpty, isEqual } from 'lodash';
import { useMemo } from 'react';
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

  const typedValue = isLookup
    ? { cellValueType, isMultipleCellValue }
    : calculateRollupTypedValue(expression, cellValueType, isMultipleCellValue);

  const onExpressionChange = (expr: IRollupFieldOptions['expression']) => {
    const { cellValueType: newCellValueType } = isLookup
      ? { cellValueType }
      : calculateRollupTypedValue(expr, cellValueType, isMultipleCellValue);
    const newOptions: IRollupFieldOptions = { expression: expr };
    if (newCellValueType !== cellValueType) {
      const defaultFormatting = getDefaultFormatting(newCellValueType);
      newOptions.formatting = defaultFormatting;
      newOptions.showAs = undefined;
    }
    onChange?.(newOptions);
  };

  const onFormattingChange = (newFormatting?: IUnionFormatting) => {
    const { cellValueType } = typedValue;
    const formattingResult = getFormattingSchema(cellValueType).safeParse(newFormatting);
    const formattingParsed = formattingResult.success ? formattingResult.data : undefined;

    if (isEqual(formattingParsed, formatting)) {
      return;
    }
    onChange?.({ formatting: isEmpty(formattingParsed) ? undefined : newFormatting });
  };

  const onShowAsChange = (newShowAs?: IUnionShowAs) => {
    const { cellValueType, isMultipleCellValue } = typedValue;
    const showAsResult = getShowAsSchema(cellValueType, isMultipleCellValue).safeParse(newShowAs);
    const showAsParsed = showAsResult.success ? showAsResult.data : undefined;

    if (isEqual(showAsParsed, showAs)) {
      return;
    }
    onChange?.({ showAs: isEmpty(showAsParsed) ? undefined : newShowAs });
  };

  const candidates = useMemo(() => {
    return ROLLUP_FUNCTIONS.map((f) => {
      let name;
      switch (f) {
        case 'countall({values})':
          name = 'Count All';
          break;
        case 'counta({values})':
          name = 'CountA';
          break;
        case 'count({values})':
          name = 'Count';
          break;
        case 'sum({values})':
          name = 'Sum';
          break;
        case 'max({values})':
          name = 'Max';
          break;
        case 'min({values})':
          name = 'Min';
          break;
        case 'and({values})':
          name = 'And';
          break;
        case 'or({values})':
          name = 'Or';
          break;
        case 'xor({values})':
          name = 'Xor';
          break;
        case 'array_join({values})':
          name = 'Array Join';
          break;
        case 'array_unique({values})':
          name = 'Array Unique';
          break;
        case 'array_compact({values})':
          name = 'Array Compact';
          break;
        case 'concatenate({values})':
          name = 'Concatenate';
          break;
        default:
          assertNever(f);
      }
      return {
        id: f,
        name,
      };
    });
  }, []);

  return (
    <div className="w-full space-y-2" data-testid="rollup-options">
      {!isLookup && (
        <div className="space-y-2">
          <span className="neutral-content label-text">Rollup</span>
          <Selector
            className="w-full"
            placeholder="Select a rollup function"
            selectedId={expression}
            onChange={(id) => {
              onExpressionChange(id as IRollupFieldOptions['expression']);
            }}
            candidates={candidates}
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
