import type { IFieldOptionsRo, IFieldVo } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { useFieldStaticGetter } from '@teable-group/sdk';
import { Textarea } from '@teable-group/ui-lib/shadcn';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { FieldOptions } from './FieldOptions';
import type { IFieldOptionsProps } from './FieldOptions';
import { useUpdateLookupOptions } from './hooks/useUpdateLookupOptions';
import { LookupOptions } from './lookup-options/LookupOptions';
import { SelectFieldType } from './SelectFieldType';
import { SystemInfo } from './SystemInfo';
import type { IFieldEditorRo } from './type';
import { useFieldTypeSubtitle } from './useFieldTypeSubtitle';

export const FieldEditor = (props: {
  field: Partial<IFieldEditorRo>;
  onChange?: (field: IFieldEditorRo) => void;
}) => {
  const { field, onChange } = props;
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

  const updateFieldName = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFieldFn({
      ...field,
      name: e.target.value || undefined,
    });
  };

  const updateFieldDesc = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFieldFn({
      ...field,
      description: e.target.value || undefined,
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
    <div className="w-full flex-1 gap-2 overflow-y-auto px-2 text-sm">
      {/* General */}
      <div className="flex flex-col gap-2">
        <div className="relative flex w-full flex-col gap-2">
          <div>
            <p className="label-text mb-2">{t('common:name')}</p>
          </div>
          <Input
            placeholder="Field name (optional)"
            className="h-8"
            value={field['name'] || ''}
            onChange={updateFieldName}
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
              value={field['description']}
              placeholder={t('table:field.editor.descriptionPlaceholder')}
              onChange={updateFieldDesc}
            />
          </div>
        )}
        <div className="flex w-full flex-col gap-2">
          <div>
            <span className="label-text mb-2">{t('table:field.editor.type')}</span>
          </div>
          <SelectFieldType
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
        {getUnionOptions()}
      </div>
    </div>
  );
};
