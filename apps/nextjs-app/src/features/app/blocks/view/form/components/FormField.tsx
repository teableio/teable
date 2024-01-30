import { useFieldStaticGetter, useView } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import type { FC } from 'react';
import { FormCellEditor } from './FormCellEditor';

interface IFormFieldEditorProps {
  field: IFieldInstance;
  value: unknown;
  errors: Set<string>;
  onChange: (value: unknown) => void;
}

export const FormField: FC<IFormFieldEditorProps> = (props) => {
  const { field, value, errors, onChange } = props;
  const view = useView();
  const activeViewId = view?.id;
  const getFieldStatic = useFieldStaticGetter();

  if (!activeViewId || !view) return null;

  const { id: fieldId, type, name, description, isLookup } = field;
  const Icon = getFieldStatic(type, isLookup).Icon;

  const required = view?.columnMeta[fieldId]?.required;
  const isError = errors.has(fieldId);

  return (
    <div className="relative w-full py-5" id={`form-field-${fieldId}`}>
      <div className="mb-2 flex w-full items-center overflow-hidden">
        <Icon className="shrink-0" />
        <h3 className="ml-1 truncate">{name}</h3>
      </div>

      {description && <div className="mb-2 text-xs text-slate-400">{description}</div>}

      <FormCellEditor
        cellValue={value}
        field={field}
        onChange={onChange}
        className={isError ? 'border-red-500' : ''}
      />

      {isError && <div className="mt-1 text-xs text-red-500">Required</div>}

      {required && <span className="absolute left-[-10px] top-5 text-red-500">*</span>}
    </div>
  );
};
