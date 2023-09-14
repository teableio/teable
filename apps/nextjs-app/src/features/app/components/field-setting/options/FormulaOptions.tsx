/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IFormulaFieldOptions,
  ILookupOptionsRo,
  INumberShowAs,
  IUnionFormatting,
} from '@teable-group/core';
import { CellValueType } from '@teable-group/core';
import { FormulaEditor } from '@teable-group/sdk/components';
import { useFields } from '@teable-group/sdk/hooks';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { FormulaField } from '@teable-group/sdk/model';
import { Dialog, DialogContent, DialogTrigger } from '@teable-group/ui-lib/shadcn';
import { keyBy } from 'lodash';
import { useMemo, useState } from 'react';
import { UnionFormatting } from '../formatting/UnionFormatting';
import { useIsMultipleCellValue } from '../hooks';
import { UnionShowAs } from '../show-as/UnionShowAs';

export const FormulaOptions = (props: {
  options: Partial<IFormulaFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  lookupField?: IFieldInstance;
  lookupOptions?: ILookupOptionsRo;
  onChange?: (options: Partial<IFormulaFieldOptions>) => void;
}) => {
  const { options = {}, isLookup, lookupField, lookupOptions, onChange } = props;
  const { formatting, expression } = options;
  const fields = useFields();
  const [visible, setVisible] = useState(false);

  const expressionByName = useMemo(() => {
    return expression
      ? FormulaField.convertExpressionIdToName(expression, keyBy(fields, 'id'), true)
      : '';
  }, [expression, fields]);

  const isLookupFieldMultiple = useIsMultipleCellValue(isLookup, lookupField, lookupOptions);

  const { cellValueType, isMultipleCellValue } = useMemo(() => {
    if (isLookup && lookupField) {
      return {
        cellValueType: lookupField.cellValueType,
        isMultipleCellValue: lookupField.isMultipleCellValue,
      };
    }
    const defaultResult = { cellValueType: CellValueType.String, isMultipleCellValue: false };
    try {
      return expression
        ? FormulaField.getParsedValueType(expression, keyBy(fields, 'id'))
        : defaultResult;
    } catch (e) {
      return defaultResult;
    }
  }, [expression, fields, isLookup, lookupField]);

  const onExpressionChange = (expr: string) => {
    onChange?.({ expression: expr });
    setVisible(false);
  };

  const onFormattingChange = (value?: IUnionFormatting) => {
    const formatting = value;
    if (isLookup) {
      return onChange?.({
        formatting,
        expression: (lookupField?.options as IFormulaFieldOptions)?.expression ?? expression,
      });
    }
    onChange?.({ formatting });
  };

  const onShowAsChange = (value?: INumberShowAs) => {
    if (isLookup) {
      return onChange?.({
        showAs: value,
        expression: (lookupField?.options as IFormulaFieldOptions)?.expression ?? expression,
      });
    }
    onChange?.({ showAs: value });
  };

  return (
    <div className="w-full space-y-2">
      {!isLookup && (
        <div className="space-y-2">
          <span className="neutral-content label-text">Formula</span>
          <Dialog open={visible} onOpenChange={setVisible}>
            <DialogTrigger asChild>
              <code className="flex items-center h-8 px-3 border border-input rounded-md bg-background ring-offset-background cursor-pointer">
                {expressionByName}
              </code>
            </DialogTrigger>
            <DialogContent
              tabIndex={-1}
              closeable
              className="max-w-full md:w-auto w-auto h-auto p-0 rounded-sm flex overflow-hidden outline-0"
            >
              <FormulaEditor expression={expression} onConfirm={onExpressionChange} />
            </DialogContent>
          </Dialog>
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
          isMultipleCellValue={isMultipleCellValue || isLookupFieldMultiple}
          onChange={onShowAsChange}
        />
      </div>
    </div>
  );
};
