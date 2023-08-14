import type { IFieldOptionsRo, IFieldRo, ILookupOptionsRo } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { useFieldStaticGetter } from '@teable-group/sdk';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { useCallback, useState } from 'react';
import { FieldOptions } from './FieldOptions';
import type { IFieldOptionsProps } from './FieldOptions';
import { LookupOptions } from './options/LookupOptions';
import { SelectFieldType } from './SelectFieldType';
import { useFieldTypeSubtitle } from './useFieldTypeSubtitle';

export const FieldEditor = (props: { field: IFieldRo; onChange?: (field: IFieldRo) => void }) => {
  const { field, onChange } = props;
  const [showDescription, setShowDescription] = useState<boolean>(Boolean(field.description));
  const setFieldFn = useCallback(
    (field: IFieldRo) => {
      onChange?.(field);
    },
    [onChange]
  );
  const getFieldSubtitle = useFieldTypeSubtitle();
  const getFieldStatic = useFieldStaticGetter();

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
        type: FieldType.SingleLineText, // reset fieldType to default
        options: undefined, // reset options
        isLookup: true,
      });
    }

    setFieldFn({
      ...field,
      type,
      isLookup: undefined,
      lookupOptions: undefined,
      options: getFieldStatic(type, false).defaultOptions as IFieldOptionsRo,
    });
  };

  const updateFieldOptions: IFieldOptionsProps['updateFieldOptions'] = useCallback(
    (options) => {
      setFieldFn({
        ...field,
        options: {
          ...(field.options || {}),
          ...options,
        },
      });
    },
    [field, setFieldFn]
  );

  const updateLookupOptions = useCallback(
    (options: Partial<ILookupOptionsRo> & { type?: FieldType }) => {
      const { type, ...lookupOptions } = options;
      setFieldFn({
        ...field,
        type: type ?? field.type,
        lookupOptions: {
          ...field.lookupOptions,
          ...(lookupOptions || {}),
        } as ILookupOptionsRo,
      });
    },
    [field, setFieldFn]
  );

  const getUnionOptions = () => {
    if (field.isLookup) {
      return (
        <>
          <LookupOptions options={field.lookupOptions} onChange={updateLookupOptions} />
          <FieldOptions
            options={field.options as IFieldOptionsProps['options']}
            type={field.type}
            isLookup={field.isLookup}
            updateFieldOptions={updateFieldOptions}
          />
        </>
      );
    }

    if (field.type === FieldType.Rollup) {
      return (
        <>
          <LookupOptions
            options={field.lookupOptions}
            onChange={(options) => {
              // ignore type in rollup lookup options
              const { type, ...lookupOptions } = options;
              updateLookupOptions(lookupOptions);
            }}
          />
          {field.lookupOptions && (
            <FieldOptions
              options={field.options as IFieldOptionsProps['options']}
              type={field.type}
              isLookup={field.isLookup}
              updateFieldOptions={updateFieldOptions}
            />
          )}
        </>
      );
    }

    return (
      <FieldOptions
        options={field.options as IFieldOptionsProps['options']}
        type={field.type}
        isLookup={field.isLookup}
        updateFieldOptions={updateFieldOptions}
      />
    );
  };

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
        {getUnionOptions()}
      </div>
    </div>
  );
};
