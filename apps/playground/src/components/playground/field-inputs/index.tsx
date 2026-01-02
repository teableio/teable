import type { Field } from '@teable/v2-core';
import { TextFieldInput } from './TextFieldInput';
import { NumberFieldInput } from './NumberFieldInput';
import { RatingFieldInput } from './RatingFieldInput';
import { CheckboxFieldInput } from './CheckboxFieldInput';
import { SelectFieldInput } from './SelectFieldInput';
import { DateFieldInput } from './DateFieldInput';
import { LinkFieldInput } from './LinkFieldInput';
import { DisabledFieldInput } from './DisabledFieldInput';
import type { FieldInputProps } from './types';

export { TextFieldInput } from './TextFieldInput';
export { NumberFieldInput } from './NumberFieldInput';
export { RatingFieldInput } from './RatingFieldInput';
export { CheckboxFieldInput } from './CheckboxFieldInput';
export { SelectFieldInput } from './SelectFieldInput';
export { DateFieldInput } from './DateFieldInput';
export { LinkFieldInput } from './LinkFieldInput';
export { DisabledFieldInput } from './DisabledFieldInput';
export type { FieldInputProps } from './types';

/**
 * Get the appropriate field input component based on field type.
 */
export function getFieldInputComponent(
  fieldType: string
): React.ComponentType<FieldInputProps> | null {
  switch (fieldType) {
    case 'singleLineText':
    case 'longText':
      return TextFieldInput;
    case 'number':
      return NumberFieldInput;
    case 'rating':
      return RatingFieldInput;
    case 'checkbox':
      return CheckboxFieldInput;
    case 'singleSelect':
    case 'multipleSelect':
      return SelectFieldInput;
    case 'date':
      return DateFieldInput;
    case 'link':
      return LinkFieldInput;
    case 'attachment':
    case 'user':
    case 'button':
      return DisabledFieldInput;
    // Computed fields - should not appear in create form
    case 'formula':
    case 'rollup':
    case 'lookup':
    case 'createdTime':
    case 'lastModifiedTime':
    case 'createdBy':
    case 'lastModifiedBy':
    case 'autoNumber':
      return null;
    default:
      return null;
  }
}

/**
 * Render a field input based on field type.
 */
export function FieldInput(props: FieldInputProps) {
  const fieldType = props.field.type().toString();
  const Component = getFieldInputComponent(fieldType);

  if (!Component) {
    return (
      <div className="text-sm text-muted-foreground p-2 border rounded-md">
        Unsupported field type: {fieldType}
      </div>
    );
  }

  return <Component {...props} />;
}
