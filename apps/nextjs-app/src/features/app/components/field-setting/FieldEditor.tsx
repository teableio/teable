import type { IFieldRo, FieldType } from '@teable-group/core';
import { useCallback, useState } from 'react';
import { useCounter } from 'react-use';
import { Input } from '@/components/ui/input';
import { fieldDefaultOptionMap } from '../../utils/field';
import type { IFieldOptionsProps } from './FieldOptions';
import { FieldOptions } from './FieldOptions';
import { LookupOptions } from './lookupOptions';
import { SelectFieldType } from './SelectFieldType';
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

  const updateFieldTypeWithLookup = (type: FieldType | 'lookup') => {
    if (type === 'lookup') {
      return setFieldFn({
        ...field,
        isLookup: true,
      });
    }

    setFieldFn({
      ...field,
      type,
      isLookup: undefined,
      options: fieldDefaultOptionMap[type],
    });
  };

  const updateFieldOptions: IFieldOptionsProps['updateFieldOptions'] = useCallback(
    (options) => {
      setFieldFn({
        ...field,
        options,
      });
    },
    [field, setFieldFn]
  );

  return (
    <div className="flex-1 w-full overflow-y-auto gap-2 px-2 text-sm">
      {/* General */}
      <div className="flex flex-col gap-2">
        <div className="w-full flex flex-col gap-2">
          <div>
            <span className="label-text mb-2">Name</span>
          </div>
          <Input
            placeholder="Field name (optional)"
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
            <Input
              className="h-8"
              value={field['description']}
              placeholder="Describe this field (optional)"
              onChange={updateFieldDesc}
            />
          </div>
        )}
        <div className="w-full flex flex-col gap-2">
          <div>
            <span className="label-text mb-2">Type</span>
          </div>
          <SelectFieldType
            value={field.type}
            isLookup={field.isLookup}
            onChange={updateFieldTypeWithLookup}
          />
          <p className="text-xs font-medium text-left text-slate-500">
            {field.isLookup
              ? 'See values from a field in a linked record.'
              : getFieldSubtitle(field.type)}
          </p>
        </div>
        <hr className="border-slate-200" />
        {field.isLookup && (
          <LookupOptions
            options={field.lookupOptions}
            onChange={(options, fieldType) => {
              setFieldFn({
                ...field,
                lookupOptions: options,
                type: fieldType,
              });
            }}
          />
        )}
        <FieldOptions
          options={field.options as IFieldOptionsProps['options']}
          type={field.type}
          isLookup={field.isLookup}
          updateFieldOptions={updateFieldOptions}
        />
      </div>
    </div>
  );
};
