import type { INumberShowAs, IRollupFieldOptions, IUnionFormatting } from '@teable-group/core';
import { assertNever, ROLLUP_FUNCTIONS, CellValueType } from '@teable-group/core';
import { RollupField } from '@teable-group/sdk/model';
import { useMemo } from 'react';
import { UnionFormatting } from '../formatting/UnionFormatting';
import { Selector } from '../Selector';
import { UnionShowAs } from '../show-as/UnionShowAs';

export const RollupOptions = (props: {
  options: Partial<IRollupFieldOptions> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<IRollupFieldOptions>) => void;
}) => {
  const { options = {}, isLookup, onChange } = props;
  const { formatting, expression } = options;

  const { cellValueType, isMultipleCellValue } = useMemo(() => {
    try {
      return expression
        ? RollupField.getParsedValueType(expression)
        : { cellValueType: CellValueType.String, isMultipleCellValue: false };
    } catch (e) {
      return { cellValueType: CellValueType.String, isMultipleCellValue: false };
    }
  }, [expression]);

  const onExpressionChange = (expression: IRollupFieldOptions['expression']) => {
    onChange?.({
      expression,
    });
  };

  const onFormattingChange = (value?: IUnionFormatting) => {
    const formatting = value;
    onChange?.({ formatting });
  };

  const candidates = useMemo(() => {
    return ROLLUP_FUNCTIONS.map((f) => {
      let name;
      switch (f) {
        case 'countall({values})':
          name = 'Count all';
          break;
        case 'sum({values})':
          name = 'Sum';
          break;
        case 'concatenate({values})':
          name = 'Concatenate';
          break;
        case 'and({values})':
          name = 'And';
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

  const onShowAsChange = (value?: INumberShowAs) => {
    onChange?.({ showAs: value });
  };

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
      <div className="space-y-2">
        <UnionShowAs
          showAs={options?.showAs}
          cellValueType={cellValueType}
          isMultipleCellValue={isMultipleCellValue}
          onChange={onShowAsChange}
        />
      </div>
    </div>
  );
};
