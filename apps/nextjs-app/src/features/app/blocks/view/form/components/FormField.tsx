import { CellEditor } from '@teable-group/sdk/components';
import { useFieldStaticGetter, useViewId } from '@teable-group/sdk/hooks';
import type { IFieldInstance } from '@teable-group/sdk/model';
import type { FC } from 'react';

interface IFormFieldEditorProps {
  field: IFieldInstance;
  value: unknown;
  errors: Set<string>;
  onChange: (value: unknown) => void;
}

export const FormField: FC<IFormFieldEditorProps> = (props) => {
  const { field, value, errors, onChange } = props;
  const activeViewId = useViewId();
  const getFieldStatic = useFieldStaticGetter();

  if (!activeViewId) return null;

  const { id: fieldId, type, name, description, isLookup } = field;
  const Icon = getFieldStatic(type, isLookup).Icon;

  const required = field.columnMeta[activeViewId]?.required;
  const isError = errors.has(fieldId);

  return (
    <div className="relative w-full py-5" id={`form-field-${fieldId}`}>
      <div className="mb-2 flex w-full items-center overflow-hidden">
        <Icon className="shrink-0" />
        <h3 className="ml-1 truncate">{name}</h3>
      </div>

      {description && <div className="mb-2 text-xs text-slate-400">{description}</div>}

      <CellEditor
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
