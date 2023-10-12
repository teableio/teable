import type {
  ILookupOptionsRo,
  IRollupFieldOptions,
  IUnionFormatting,
  IUnionShowAs,
} from '@teable-group/core';
import { assertNever, ROLLUP_FUNCTIONS, CellValueType } from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { RollupField } from '@teable-group/sdk/model';
import { Selector } from '@teable-group/ui-lib/base';
import { useMemo } from 'react';
import { UnionFormatting } from '../formatting/UnionFormatting';
import { useIsMultipleCellValue } from '../hooks';
import { UnionShowAs } from '../show-as/UnionShowAs';

export const RollupOptions = (props: {
  options: Partial<IRollupFieldOptions> | undefined;
  isLookup?: boolean;
  lookupField?: IFieldInstance;
  lookupOptions?: ILookupOptionsRo;
  onChange?: (options: Partial<IRollupFieldOptions>) => void;
}) => {
  const { options = {}, isLookup, lookupField, lookupOptions, onChange } = props;
  const { formatting, expression } = options;

  const isLookupFieldMultiple = useIsMultipleCellValue(isLookup, lookupField, lookupOptions);

  const { cellValueType, isMultipleCellValue } = useMemo(() => {
    const defaultResult = { cellValueType: CellValueType.String, isMultipleCellValue: false };
    if (!lookupField) {
      return defaultResult;
    }

    if (isLookup) {
      return {
        cellValueType: lookupField.cellValueType,
        isMultipleCellValue: lookupField.isMultipleCellValue,
      };
    }
    try {
      return expression
        ? RollupField.getParsedValueType(expression, lookupField, isLookupFieldMultiple)
        : defaultResult;
    } catch (e) {
      return defaultResult;
    }
  }, [expression, isLookup, isLookupFieldMultiple, lookupField]);

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
        expression: (lookupField?.options as IRollupFieldOptions)?.expression ?? expression,
      });
    }
    onChange?.({ formatting });
  };

  const onShowAsChange = (value?: IUnionShowAs) => {
    if (isLookup) {
      return onChange?.({
        showAs: value,
        expression: (lookupField?.options as IRollupFieldOptions)?.expression ?? expression,
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
            placeholder="Select a rollup function"
            selectedId={expression}
            onChange={(id) => {
              onExpressionChange(id as IRollupFieldOptions['expression']);
            }}
            candidates={candidates}
          />
        </div>
      )}
      <div className="space-y-2">
        <UnionFormatting
          cellValueType={cellValueType}
          formatting={formatting}
          onChange={onFormattingChange}
        />
      </div>
      {Boolean(expression) && (
        <div className="space-y-2">
          <UnionShowAs
            showAs={options?.showAs}
            cellValueType={cellValueType}
            isMultipleCellValue={isMultipleCellValue || isLookupFieldMultiple}
            onChange={onShowAsChange}
          />
        </div>
      )}
    </div>
  );
};
