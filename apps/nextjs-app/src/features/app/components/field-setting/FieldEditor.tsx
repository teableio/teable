import type {
  FormulaFieldOptions,
  IFieldRo,
  ILinkFieldOptionsRo,
  LinkFieldOptions,
  NumberFieldOptions,
  SelectFieldOptions,
} from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { Input, Select } from 'antd';
import { useCallback, useMemo, useState } from 'react';
import { useCounter } from 'react-use';
import { FIELD_CONSTANT, fieldDefaultOptionMap } from '../../utils/field';
import { FormulaOptions } from './FormulaOptions';
import { LinkOptions } from './LinkOptions';
import { NumberOptions } from './NumberOptions';
import { SelectOptions } from './SelectOptions';

const { Option } = Select;

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

  const setFieldFn = useCallback(
    (field: IFieldRo) => {
      incUpdateCount();
      setField(field);
      onChange?.(field, updateCount);
    },
    [incUpdateCount, onChange, updateCount]
  );

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

  const updateFieldType = (type: FieldType) => {
    setFieldFn({
      ...field,
      type,
      options: fieldDefaultOptionMap[type],
    });
  };

  const updateFieldOptions = useCallback(
    (
      options: NumberFieldOptions | SelectFieldOptions | ILinkFieldOptionsRo | FormulaFieldOptions
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
      default:
        return;
    }
  }, [field.options, field.type, updateFieldOptions]);

  return (
    <div className="flex-1 w-full overflow-y-auto text-sm">
      {/* General */}
      <div className="flex p-8 border-b">
        <div className="text-scale-1200 basis-1/3 col-span-12 p-2">General</div>
        <div className="basis-2/3">
          <div className="w-full">
            <div className="pb-2">
              <span className="label-text mb-2">Name</span>
            </div>
            <Input value={field['name']} onChange={updateFieldName} />
          </div>
          <div className="w-full mt-1">
            <div className="pb-2">
              <span className="label-text mb-2">Description</span>
            </div>
            <Input value={field['description']} onChange={updateFieldDesc} />
          </div>
        </div>
      </div>
      {/* Field type */}
      <div className="flex p-8 border-b">
        <div className="text-scale-1200 basis-1/3 col-span-12 p-2">Type</div>
        <div className="basis-2/3">
          <div className="w-full">
            <div className="pb-2">
              <span className="neutral-content mb-2">Name</span>
            </div>
            <Select className="w-full" showSearch value={field.type} onChange={updateFieldType}>
              {FIELD_CONSTANT.map(({ type, text, IconComponent }) => (
                <Option key={type} value={type} label={text}>
                  <div className="flex items-center">
                    <IconComponent />
                    <span className="ml-1">{text}</span>
                  </div>
                </Option>
              ))}
            </Select>
          </div>
        </div>
      </div>
      {/* Field options */}
      {optionComponent && <div className="p-8">{optionComponent}</div>}
    </div>
  );
};
