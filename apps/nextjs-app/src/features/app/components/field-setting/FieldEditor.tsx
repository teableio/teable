import type {
  DateFieldOptions,
  FormulaFieldOptions,
  IFieldRo,
  ILinkFieldOptionsRo,
  LinkFieldOptions,
  NumberFieldOptions,
  SelectFieldOptions,
} from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { useCallback, useMemo, useState } from 'react';
import { useCounter } from 'react-use';
import { Input } from '@/components/ui/input';
import { fieldDefaultOptionMap } from '../../utils/field';
import { DateOptions } from './DateOptions';
import { FormulaOptions } from './FormulaOptions';
import { LinkOptions } from './LinkOptions';
import { NumberOptions } from './NumberOptions';
import { SelectFieldType } from './SelectFieldType';
import { SelectOptions } from './SelectOptions';
import { useFieldTypeSubtitle } from './useFieldTypeSubtitle';

export const FieldEditor = (props: {
  field: IFieldRo;
  onChange?: (field: IFieldRo, updateCount?: number) => void;
}) => {
  const { field: currentField, onChange } = props;
  const [field, setField] = useState<IFieldRo>({
    name: currentField.name,
    description: currentField.description || '',
    type: currentField.type,
    options: currentField.options,
  });
  const [updateCount, { inc: incUpdateCount }] = useCounter(0);
  const [showDescription, setShowDescription] = useState<boolean>(Boolean(field.description));
  const setFieldFn = useCallback(
    (field: IFieldRo) => {
      incUpdateCount();
      setField(field);
      onChange?.(field, updateCount);
    },
    [incUpdateCount, onChange, updateCount]
  );
  const getFieldSubtitle = useFieldTypeSubtitle();

  const updateFieldName = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFieldFn({
      ...field,
      name: e.target.value,
    });
  };

  const updateFieldDesc = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFieldFn({
      ...field,
      description: e.target.value,
    });
  };

  const updateFieldType = (type: FieldType | 'lookup') => {
    if (type === 'lookup') {
      return;
    }
    setFieldFn({
      ...field,
      type,
      options: fieldDefaultOptionMap[type],
    });
  };

  const updateFieldOptions = useCallback(
    (
      options:
        | NumberFieldOptions
        | SelectFieldOptions
        | ILinkFieldOptionsRo
        | FormulaFieldOptions
        | DateFieldOptions
    ) => {
      setFieldFn({
        ...field,
        options,
      });
    },
    [field, setFieldFn]
  );

  const optionComponent = useMemo(() => {
    if (!field.options) {
      return;
    }
    switch (field.type) {
      case FieldType.SingleSelect:
      case FieldType.MultipleSelect:
        return (
          <SelectOptions
            options={field.options as SelectFieldOptions}
            onChange={updateFieldOptions}
          />
        );
      case FieldType.Number:
        return (
          <NumberOptions
            options={field.options as NumberFieldOptions}
            onChange={updateFieldOptions}
          />
        );
      case FieldType.Link:
        return (
          <LinkOptions options={field.options as LinkFieldOptions} onChange={updateFieldOptions} />
        );
      case FieldType.Formula:
        return (
          <FormulaOptions
            options={field.options as FormulaFieldOptions}
            onChange={updateFieldOptions}
          />
        );
      case FieldType.Date:
        return (
          <DateOptions options={field.options as DateFieldOptions} onChange={updateFieldOptions} />
        );
      default:
        return;
    }
  }, [field.options, field.type, updateFieldOptions]);

  return (
    <div className="flex-1 w-full overflow-y-auto gap-2 text-sm">
      {/* General */}
      <div className="flex flex-col gap-2">
        <div className="w-full flex flex-col gap-2">
          <div>
            <span className="label-text mb-2">Name</span>
          </div>
          <Input
            placeholder="Field name"
            className="h-8"
            value={field['name']}
            onChange={updateFieldName}
          />
          {!showDescription && (
            <p className="text-xs font-medium text-left text-slate-500">
              <span
                onClick={() => {
                  setShowDescription(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setShowDescription(true);
                  }
                }}
                tabIndex={0}
                role={'button'}
                className="cursor-pointer border-b border-solid border-slate-500 "
              >
                Add Description
              </span>
            </p>
          )}
        </div>
        {showDescription && (
          <div className="w-full flex flex-col gap-2">
            <div>
              <span className="label-text mb-2">Description</span>
            </div>
            <Input className="h-8" value={field['description']} onChange={updateFieldDesc} />
          </div>
        )}
        <div className="w-full flex flex-col gap-2">
          <div>
            <span className="label-text mb-2">Type</span>
          </div>
          <SelectFieldType value={field.type} onChange={updateFieldType} />
          <p className="text-xs font-medium text-left text-slate-500">
            {getFieldSubtitle(field.type)}
          </p>
        </div>
        <hr className=" border-slate-200" />
        {/* Field options */}
        {optionComponent}
      </div>
    </div>
  );
};
