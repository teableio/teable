import { useQuery } from '@tanstack/react-query';
import type {
  IFieldVo,
  IDateFieldOptions,
  IFormulaFieldOptions,
  ILinkFieldOptionsRo,
  INumberFieldOptions,
  ISelectFieldOptions,
  IRollupFieldOptions,
  IRatingFieldOptions,
  ISingleLineTextFieldOptions,
  ICreatedTimeFieldOptions,
  ILastModifiedTimeFieldOptions,
  IUserFieldOptions,
  ICheckboxFieldOptions,
  ILongTextFieldOptions,
  IButtonFieldOptions,
  IConditionalRollupFieldOptions,
} from '@teable/core';
import {
  CellValueType,
  FieldType,
  getRollupFunctionsByCellValueType,
  isLinkLookupOptions,
} from '@teable/core';
import { getField } from '@teable/openapi';
import { useFields } from '@teable/sdk/hooks';
import { useMemo } from 'react';
import { ButtonOptions } from './options/ButtonOptions';
import { CheckboxOptions } from './options/CheckboxOptions';
import { ConditionalRollupOptions } from './options/ConditionalRollupOptions';
import { CreatedTimeOptions } from './options/CreatedTimeOptions';
import { DateOptions } from './options/DateOptions';
import { FormulaOptions } from './options/FormulaOptions';
import { LinkOptions } from './options/LinkOptions';
import { LongTextOptions } from './options/LongTextOptions';
import { NumberOptions } from './options/NumberOptions';
import { RatingOptions } from './options/RatingOptions';
import { RollupOptions } from './options/RollupOptions';
import { SelectOptions } from './options/SelectOptions/SelectOptions';
import { SingleLineTextOptions } from './options/SingleLineTextOptions';
import { UserOptions } from './options/UserOptions';
import type { IFieldEditorRo } from './type';

export interface IFieldOptionsProps {
  field: IFieldEditorRo;
  onChange: (options: Partial<IFieldVo['options']>) => void;
  onSave?: () => void;
}

export const FieldOptions: React.FC<IFieldOptionsProps> = ({ field, onChange, onSave }) => {
  const { id, type, isLookup, cellValueType, isMultipleCellValue, options } = field;
  const lookupField = useRollupLookupField(field.lookupOptions);
  const lookupCellValueType = useMemo(
    () => normalizeCellValueType(lookupField?.cellValueType),
    [lookupField?.cellValueType]
  );
  const normalizedFieldCellValueType = useMemo(
    () => normalizeCellValueType(cellValueType),
    [cellValueType]
  );
  const effectiveRollupCellValueType = lookupCellValueType ?? normalizedFieldCellValueType;
  const rollupAvailableExpressions = useMemo(() => {
    return effectiveRollupCellValueType
      ? getRollupFunctionsByCellValueType(effectiveRollupCellValueType)
      : undefined;
  }, [effectiveRollupCellValueType]);
  const effectiveIsMultiple = isMultipleCellValue ?? lookupField?.isMultipleCellValue ?? undefined;
  switch (type) {
    case FieldType.SingleLineText:
      return (
        <SingleLineTextOptions
          isLookup={isLookup}
          options={options as ISingleLineTextFieldOptions}
          onChange={onChange}
        />
      );
    case FieldType.LongText:
      return (
        <LongTextOptions
          options={options as ILongTextFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.SingleSelect:
    case FieldType.MultipleSelect:
      return (
        <SelectOptions
          isMultiple={type === FieldType.MultipleSelect}
          options={options as ISelectFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.Number:
      return (
        <NumberOptions
          options={options as INumberFieldOptions}
          isLookup={isLookup}
          isMultipleCellValue={isMultipleCellValue}
          onChange={onChange}
        />
      );
    case FieldType.Link:
      return (
        <LinkOptions
          fieldId={id}
          options={options as ILinkFieldOptionsRo}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.Formula:
      return (
        <FormulaOptions
          options={options as IFormulaFieldOptions}
          isLookup={isLookup}
          cellValueType={cellValueType}
          isMultipleCellValue={isMultipleCellValue}
          onChange={onChange}
        />
      );
    case FieldType.User:
      return (
        <UserOptions
          options={options as IUserFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.Date:
      return (
        <DateOptions
          options={options as IDateFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.CreatedTime:
      return (
        <CreatedTimeOptions options={options as ICreatedTimeFieldOptions} onChange={onChange} />
      );
    case FieldType.LastModifiedTime:
      return (
        <CreatedTimeOptions
          options={options as ILastModifiedTimeFieldOptions}
          onChange={onChange}
        />
      );
    case FieldType.Rating:
      return (
        <RatingOptions
          options={options as IRatingFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.Checkbox:
      return (
        <CheckboxOptions
          options={options as ICheckboxFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.Rollup:
      return (
        <RollupOptions
          options={options as IRollupFieldOptions}
          isLookup={isLookup}
          cellValueType={effectiveRollupCellValueType}
          isMultipleCellValue={effectiveIsMultiple}
          availableExpressions={rollupAvailableExpressions}
          onChange={onChange}
        />
      );
    case FieldType.ConditionalRollup:
      return (
        <ConditionalRollupOptions
          fieldId={id}
          options={options as IConditionalRollupFieldOptions}
          onChange={onChange}
        />
      );
    case FieldType.Button:
      return (
        <ButtonOptions
          options={options as IButtonFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
          onSave={onSave}
        />
      );
    default:
      return <></>;
  }
};

const normalizeCellValueType = (value: unknown): CellValueType | undefined => {
  if (
    typeof value === 'string' &&
    (Object.values(CellValueType) as string[]).includes(value as CellValueType)
  ) {
    return value as CellValueType;
  }
  return undefined;
};

const useRollupLookupField = (
  lookupOptions: IFieldEditorRo['lookupOptions']
): Pick<IFieldVo, 'cellValueType' | 'isMultipleCellValue'> | undefined => {
  const linkOptions = isLinkLookupOptions(lookupOptions) ? lookupOptions : undefined;
  const lookupFieldId = linkOptions?.lookupFieldId;
  const foreignTableId = linkOptions?.foreignTableId;
  const fields = useFields({ withHidden: true, withDenied: true });

  const localLookupField = useMemo(() => {
    if (!lookupFieldId) return undefined;
    return fields.find((field) => field.id === lookupFieldId);
  }, [fields, lookupFieldId]);

  const shouldFetchLookupField = Boolean(foreignTableId && lookupFieldId) && !localLookupField;

  const { data: remoteLookupField } = useQuery({
    queryKey: ['rollup-lookup-field', foreignTableId, lookupFieldId],
    queryFn: async () => {
      const res = await getField(foreignTableId!, lookupFieldId!);
      return res.data;
    },
    enabled: shouldFetchLookupField,
  });

  return localLookupField ?? remoteLookupField;
};
