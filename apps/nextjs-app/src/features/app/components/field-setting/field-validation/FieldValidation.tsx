import type { FieldType } from '@teable/core';
import {
  checkFieldUniqueValidationEnabled,
  checkFieldNotNullValidationEnabled,
} from '@teable/core';
import { Label, Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import type { IFieldEditorRo } from '../type';
import { FieldOperator } from '../type';

interface IFieldValidationProps {
  field: Partial<IFieldEditorRo>;
  operator: FieldOperator;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

const VALIDATION_UNIQUE = 'field-validation-unique';
const VALIDATION_NOT_NULL = 'field-validation-not-null';

export const FieldValidation = (props: IFieldValidationProps) => {
  const { field, operator, onChange } = props;
  const { isLookup, unique, notNull } = field;
  const fieldType = field.type as FieldType;
  const isEditField = operator === FieldOperator.Edit;
  const isUniqueEnabled = checkFieldUniqueValidationEnabled(fieldType, isLookup);
  const isNotNullEnabled = isEditField && checkFieldNotNullValidationEnabled(fieldType, isLookup);

  const { t } = useTranslation(tableConfig.i18nNamespaces);

  if (!isUniqueEnabled && !isNotNullEnabled) {
    return null;
  }

  return (
    <>
      <div className="flex flex-col gap-2 border-t pt-4">
        <span className="neutral-content text-sm font-medium">
          {t('table:field.editor.fieldValidationRules')}
        </span>

        {isUniqueEnabled && (
          <div className="flex h-8 items-center space-x-2">
            <Switch
              id={VALIDATION_UNIQUE}
              checked={Boolean(unique)}
              onCheckedChange={(checked) => {
                onChange?.({ unique: checked });
              }}
            />
            <Label htmlFor={VALIDATION_UNIQUE} className="font-normal leading-tight">
              {t('table:field.editor.enableValidateFieldUnique')}
            </Label>
          </div>
        )}

        {isNotNullEnabled && (
          <div className="flex h-8 items-center space-x-2">
            <Switch
              id={VALIDATION_NOT_NULL}
              checked={Boolean(notNull)}
              onCheckedChange={(checked) => {
                onChange?.({ notNull: checked });
              }}
            />
            <Label htmlFor={VALIDATION_NOT_NULL} className="font-normal leading-tight">
              {t('table:field.editor.enableValidateFieldNotNull')}
            </Label>
          </div>
        )}
      </div>
    </>
  );
};
