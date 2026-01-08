import type { Field } from './Field';
import { FieldType } from './FieldType';
import type { AttachmentField } from './types/AttachmentField';
import type { AutoNumberField } from './types/AutoNumberField';
import type { ButtonField } from './types/ButtonField';
import type { CheckboxField } from './types/CheckboxField';
import type { ConditionalRollupField } from './types/ConditionalRollupField';
import type { DateField } from './types/DateField';
import type { FormulaField } from './types/FormulaField';
import type { MultipleSelectField } from './types/MultipleSelectField';
import type { NumberField } from './types/NumberField';
import type { RatingField } from './types/RatingField';
import type { RollupField } from './types/RollupField';
import type { UserField } from './types/UserField';

export function isFormulaField(f: Field): f is FormulaField {
  return f.type().equals(FieldType.formula());
}

export function isRollupField(f: Field): f is RollupField {
  return f.type().equals(FieldType.rollup());
}

export function isConditionalRollupField(f: Field): f is ConditionalRollupField {
  return f.type().equals(FieldType.conditionalRollup());
}

export function isNumericField(f: Field): f is NumberField | RatingField | AutoNumberField {
  return (
    f.type().equals(FieldType.number()) ||
    f.type().equals(FieldType.rating()) ||
    f.type().equals(FieldType.autoNumber())
  );
}

export function isDateField(f: Field): f is DateField {
  return f.type().equals(FieldType.date());
}

export function isBooleanField(f: Field): f is CheckboxField {
  return f.type().equals(FieldType.checkbox());
}

export function isJsonValueField(
  f: Field
): f is AttachmentField | UserField | ButtonField | MultipleSelectField {
  return (
    f.type().equals(FieldType.attachment()) ||
    f.type().equals(FieldType.user()) ||
    f.type().equals(FieldType.button()) ||
    f.type().equals(FieldType.multipleSelect())
  );
}
