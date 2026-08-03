import { useFieldStaticGetter, useView } from '@teable/sdk/hooks';
import type { FormView, IFieldInstance } from '@teable/sdk/model';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { isProtectedField } from '../util';
import { FormCellEditor } from './FormCellEditor';

interface IFormFieldEditorProps {
  field: IFieldInstance;
  value: unknown;
  errors: Set<string>;
  onChange: (value: unknown) => void;
}

export const FormField: FC<IFormFieldEditorProps> = (props) => {
  const { field, value, errors, onChange } = props;
  const view = useView() as FormView | undefined;
  const activeViewId = view?.id;
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  if (!activeViewId || !view) return null;

  const { id: fieldId, type, name, description, isLookup, aiConfig } = field;
  const Icon = getFieldStatic(type, {
    isLookup,
    isConditionalLookup: field.isConditionalLookup,
    hasAiConfig: Boolean(aiConfig),
  }).Icon;

  const isProtected = isProtectedField(field);
  const required = isProtected || view?.columnMeta[fieldId]?.required;
  const isError = errors.has(fieldId);

  return (
    <div className="relative w-full py-5" id={`form-field-${fieldId}`}>
      <div className="mb-2 flex w-full overflow-hidden">
        <div className="flex h-6 shrink-0 items-center">
          <Icon className="size-4 shrink-0" />
        </div>
        <h3 className="ml-1">{name}</h3>
      </div>

      {description && (
        <div className="mb-2 whitespace-pre-line text-xs text-slate-400">{description}</div>
      )}

      <FormCellEditor
        cellValue={value}
        field={field}
        onChange={onChange}
        className={isError ? 'border-red-500 focus-visible:ring-transparent' : ''}
      />

      {isError && <div className="mt-1 text-xs text-red-500">{t('required')}</div>}

      {required && <span className="absolute left-[-10px] top-5 text-red-500">*</span>}
    </div>
  );
};
