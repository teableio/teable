import type { IFormulaFieldOptions, ILookupOptionsRo } from '@teable-group/core';
import { getFormattingSchema, getShowAsSchema, CellValueType } from '@teable-group/core';
import { FormulaEditor } from '@teable-group/sdk/components';
import { useFields } from '@teable-group/sdk/hooks';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { FormulaField } from '@teable-group/sdk/model';
import { Dialog, DialogContent, DialogTrigger } from '@teable-group/ui-lib/shadcn';
import { isEmpty, isEqual, keyBy } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
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
  const { expression } = options;
  const [formatting, setFormatting] = useState(options.formatting);
  const [showAs, setShowAs] = useState(options.showAs);
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

  useEffect(() => {
    const formattingResult = getFormattingSchema(cellValueType).safeParse(formatting);
    const showAsResult = getShowAsSchema(cellValueType, isMultipleCellValue).safeParse(showAs);

    const formattingParsed = formattingResult.success ? formattingResult.data : undefined;
    const showAsParsed = showAsResult.success ? showAsResult.data : undefined;
    if (isEqual(formattingParsed, options.formatting) && isEqual(showAsParsed, options.showAs)) {
      return;
    }
    onChange?.({
      formatting: isEmpty(formattingParsed) ? undefined : formatting,
      showAs: isEmpty(showAsParsed) ? undefined : showAs,
    });
  }, [cellValueType, isMultipleCellValue, onChange, formatting, showAs, options]);

  return (
    <div className="w-full space-y-2">
      {!isLookup && (
        <div className="space-y-2">
          <span className="neutral-content label-text">Formula</span>
          <Dialog open={visible} onOpenChange={setVisible}>
            <DialogTrigger asChild>
              <code className="flex h-8 cursor-pointer items-center rounded-md border border-input bg-background px-3 ring-offset-background">
                {expressionByName}
              </code>
            </DialogTrigger>
            <DialogContent
              tabIndex={-1}
              closeable
              className="flex h-auto w-auto max-w-full overflow-hidden rounded-sm p-0 outline-0 md:w-auto"
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
          onChange={setFormatting}
        />
      </div>
      {Boolean(expression) && (
        <div className="space-y-2">
          <UnionShowAs
            showAs={showAs}
            cellValueType={cellValueType}
            isMultipleCellValue={isMultipleCellValue || isLookupFieldMultiple}
            onChange={setShowAs}
          />
        </div>
      )}
    </div>
  );
};
