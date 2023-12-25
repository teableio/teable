import type { IRollupFieldOptions, IUnionFormatting, IUnionShowAs } from '@teable-group/core';
import { assertNever, ROLLUP_FUNCTIONS, CellValueType } from '@teable-group/core';
import { RollupField } from '@teable-group/sdk/model';
import { Selector } from '@teable-group/ui-lib/base';
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
  const { formatting, expression } = options;

  const typedValue = isLookup
    ? { cellValueType, isMultipleCellValue }
    : calculateRollupTypedValue(expression, cellValueType, isMultipleCellValue);

  const onExpressionChange = (expression: IRollupFieldOptions['expression']) => {
    onChange?.({
      expression,
    });
  };

  const onFormattingChange = (value?: IUnionFormatting) => {
    const formatting = value;
    if (isLookup) {
      return onChange?.({
        formatting,
      });
    }
    onChange?.({ formatting });
  };

  const onShowAsChange = (value?: IUnionShowAs) => {
    if (isLookup) {
      return onChange?.({
        showAs: value,
      });
    }
    onChange?.({ showAs: value });
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
    <div className="w-full space-y-2">
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
