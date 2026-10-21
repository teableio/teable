import type { Field } from './Field';
import { ConditionalLookupField } from './types/ConditionalLookupField';
import { LookupField } from './types/LookupField';

/**
 * A lookup (regular or conditional) surfaces its inner field's type to users:
 * the field DTO, the statistic menu and group headers all use the inner type.
 * Behavior that branches on field type must resolve through the wrappers to
 * match what the user sees.
 */
export const resolveEffectiveField = (field: Field): Field => {
  if (field instanceof LookupField || field instanceof ConditionalLookupField) {
    const inner = field.innerField();
    return inner.isOk() ? resolveEffectiveField(inner.value) : field;
  }
  return field;
};
