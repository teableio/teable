import type { IFieldOptionsRo, IFieldVo } from '@teable/core';
import {
  FieldType,
  checkFieldNotNullValidationEnabled,
  checkFieldUniqueValidationEnabled,
} from '@teable/core';
import { useFieldStaticGetter } from '@teable/sdk';
import { Textarea } from '@teable/ui-lib/shadcn';
import { Input } from '@teable/ui-lib/shadcn/ui/input';
import { useTranslation } from 'next-i18next';
import { useCallback, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { FieldValidation } from './field-validation/FieldValidation';
import { FieldOptions } from './FieldOptions';
import type { IFieldOptionsProps } from './FieldOptions';
import { useUpdateLookupOptions } from './hooks/useUpdateLookupOptions';
import { LookupOptions } from './lookup-options/LookupOptions';
import { SelectFieldType } from './SelectFieldType';
import { SystemInfo } from './SystemInfo';
import { FieldOperator } from './type';
import type { IFieldEditorRo } from './type';
import { useFieldTypeSubtitle } from './useFieldTypeSubtitle';

export const FieldEditor = (props: {
  isPrimary?: boolean;
  field: Partial<IFieldEditorRo>;
  operator: FieldOperator;
  onChange?: (field: IFieldEditorRo) => void;
}) => {
  const { isPrimary, field, operator, onChange } = props;
  const [showDescription, setShowDescription] = useState<boolean>(Boolean(field.description));
  const setFieldFn = useCallback(
    (field: IFieldEditorRo) => {
      onChange?.(field);
    },
    [onChange]
  );
  const getFieldSubtitle = useFieldTypeSubtitle();
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const updateFieldProps = (props: Partial<IFieldEditorRo>) => {
    setFieldFn({
      ...field,
      ...props,
    });
  };

  const updateFieldTypeWithLookup = (type: FieldType | 'lookup') => {
    if (type === 'lookup') {
      return setFieldFn({
        ...field,
        type: FieldType.SingleLineText, // reset fieldType to default
        options: undefined, // reset options
        isLookup: true,
        unique: undefined,
        notNull: undefined,
      });
    }

    let options: IFieldOptionsRo | undefined = getFieldStatic(type, false)
      .defaultOptions as IFieldOptionsRo;

    if (
      [field.type, type].every((t) =>
        [FieldType.MultipleSelect, FieldType.SingleSelect].includes(t as FieldType)
      )
    ) {
      options = field.options;
    }

    setFieldFn({
      ...field,
      type,
      isLookup: undefined,
      lookupOptions: undefined,
      options,
      unique: checkFieldUniqueValidationEnabled(type, field.isLookup) ? field.unique : undefined,
      notNull:
        operator === FieldOperator.Edit && checkFieldNotNullValidationEnabled(type, field.isLookup)
          ? field.notNull
          : undefined,
    });
  };

  const updateFieldOptions: IFieldOptionsProps['onChange'] = useCallback(
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

  const updateLookupOptions = useUpdateLookupOptions(field, setFieldFn);

  const getUnionOptions = () => {
    if (field.isLookup) {
      return (
        <>
          <LookupOptions options={field.lookupOptions} onChange={updateLookupOptions} />
          <hr className="my-2" />
          <FieldOptions field={field} onChange={updateFieldOptions} />
        </>
      );
    }

    if (field.type === FieldType.Rollup) {
      return (
        <>
          <LookupOptions options={field.lookupOptions} onChange={updateLookupOptions} />
          {field.lookupOptions && <FieldOptions field={field} onChange={updateFieldOptions} />}
        </>
      );
    }

    return <FieldOptions field={field} onChange={updateFieldOptions} />;
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-2 overflow-y-auto px-2 text-sm">
      <div className="relative flex w-full flex-col gap-2">
        <p className="label-text">{t('common:name')}</p>
        <Input
          placeholder={t('table:field.fieldNameOptional')}
          type="text"
          className="h-8"
          value={field['name'] || ''}
          data-1p-ignore="true"
          autoComplete="off"
          onChange={(e) => updateFieldProps({ name: e.target.value || undefined })}
        />
        {/* should place after the name input to make sure tab index correct */}
        <SystemInfo field={field as IFieldVo} />
        {!showDescription && (
          <p className="text-left text-xs font-medium text-slate-500">
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
              {t('table:field.editor.addDescription')}
            </span>
          </p>
        )}
      </div>
      {showDescription && (
        <div className="flex w-full flex-col gap-2">
          <div>
            <span className="label-text mb-2">{t('common:description')}</span>
          </div>
          <Textarea
            className="h-12 resize-none"
            value={field['description'] || undefined}
            placeholder={t('table:field.editor.descriptionPlaceholder')}
            onChange={(e) => updateFieldProps({ description: e.target.value || undefined })}
          />
        </div>
      )}
      <div className="flex w-full flex-col gap-2">
        <div>
          <span className="label-text mb-2">{t('table:field.editor.type')}</span>
        </div>
        <SelectFieldType
          isPrimary={isPrimary}
          value={field.isLookup ? 'lookup' : field.type}
          onChange={updateFieldTypeWithLookup}
        />
        <p className="text-left text-xs font-medium text-slate-500">
          {field.isLookup
            ? t('table:field.subTitle.lookup')
            : getFieldSubtitle(field.type as FieldType)}
        </p>
      </div>
      <hr className="border-slate-200" />
      <FieldValidation field={field} operator={operator} onChange={updateFieldProps} />
      {getUnionOptions()}
    </div>
  );
};
