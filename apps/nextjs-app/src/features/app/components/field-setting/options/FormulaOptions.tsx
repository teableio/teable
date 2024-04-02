import type { IFormulaFieldOptions } from '@teable/core';
import { getFormattingSchema, getShowAsSchema, CellValueType } from '@teable/core';
import { FormulaEditor } from '@teable/sdk/components';
import { useFields } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { FormulaField } from '@teable/sdk/model';
import { Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { isEmpty, isEqual, keyBy } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import { UnionFormatting } from '../formatting/UnionFormatting';
import { UnionShowAs } from '../show-as/UnionShowAs';

const calculateTypedValue = (fields: IFieldInstance[], expression?: string) => {
  const defaultResult = { cellValueType: CellValueType.String, isMultipleCellValue: false };

  try {
    return expression
      ? FormulaField.getParsedValueType(expression, keyBy(fields, 'id'))
      : defaultResult;
  } catch (e) {
    return defaultResult;
  }
};

export const FormulaOptionsInner = (props: {
  options: Partial<IFormulaFieldOptions> | undefined;
  onChange?: (options: Partial<IFormulaFieldOptions>) => void;
}) => {
  const { options = {}, onChange } = props;
  const { expression } = options;
  const [formatting, setFormatting] = useState(options.formatting);
  const [showAs, setShowAs] = useState(options.showAs);
  const fields = useFields({ withHidden: true });
  const [visible, setVisible] = useState(false);

  const expressionByName = useMemo(() => {
    return expression
      ? FormulaField.convertExpressionIdToName(expression, keyBy(fields, 'id'))
      : '';
  }, [expression, fields]);

  const onExpressionChange = (expr: string) => {
    onChange?.({ expression: expr });
    setVisible(false);
  };

  const { cellValueType, isMultipleCellValue } = calculateTypedValue(fields, expression);

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
      <div className="space-y-2">
        <span className="neutral-content label-text">Formula</span>
        <Dialog open={visible} onOpenChange={setVisible}>
          <DialogTrigger asChild>
            <code className="block min-h-[36px] cursor-pointer items-center whitespace-pre-wrap break-words rounded-md border border-input bg-background px-3 py-2 ring-offset-background">
              {expressionByName}
            </code>
          </DialogTrigger>
          <DialogContent
            tabIndex={-1}
            closeable
            className="flex size-auto max-w-full overflow-hidden rounded-sm p-0 outline-0 md:w-auto"
          >
            <FormulaEditor expression={expression} onConfirm={onExpressionChange} />
          </DialogContent>
        </Dialog>
      </div>
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
            isMultipleCellValue={isMultipleCellValue}
            onChange={setShowAs}
          />
        </div>
      )}
    </div>
  );
};

export const FormulaOptions = (props: {
  options: Partial<IFormulaFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  isMultipleCellValue?: boolean;
  onChange?: (options: Partial<IFormulaFieldOptions>) => void;
}) => {
  const {
    options,
    isLookup,
    cellValueType = CellValueType.String,
    isMultipleCellValue,
    onChange,
  } = props;
  const { expression, formatting, showAs } = options || {};

  if (isLookup) {
    return (
      <div className="w-full space-y-2">
        <div className="space-y-2">
          <UnionFormatting
            cellValueType={cellValueType}
            formatting={formatting}
            onChange={(formatting) => onChange?.({ formatting })}
          />
        </div>
        {Boolean(expression) && (
          <div className="space-y-2">
            <UnionShowAs
              showAs={showAs}
              cellValueType={cellValueType}
              isMultipleCellValue={isMultipleCellValue}
              onChange={(showAs) => onChange?.({ showAs })}
            />
          </div>
        )}
      </div>
    );
  }
  return <FormulaOptionsInner options={options} onChange={onChange} />;
};
