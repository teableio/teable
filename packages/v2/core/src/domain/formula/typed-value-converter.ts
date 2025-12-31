import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../shared/DomainError';
import { domainError } from '../shared/DomainError';
import type { FormulaFunc } from './functions/common';
import { TypedValue } from './typed-value';

export class TypedValueConverter {
  // transform array value to non-array value when function does not accept multiple values
  transformMultipleValue(typedValue: TypedValue, func: FormulaFunc): TypedValue {
    if (!typedValue.isMultiple || func.acceptMultipleValue) {
      return typedValue;
    }

    return new TypedValue(
      typedValue.value,
      typedValue.type,
      false,
      typedValue.field,
      typedValue.isBlank
    );
  }

  convertTypedValue(typedValue: TypedValue, func: FormulaFunc): Result<TypedValue, DomainError> {
    const normalized = this.transformMultipleValue(typedValue, func);
    if (func.acceptValueType.has(normalized.type)) {
      return ok(normalized);
    }

    const firstAcceptValueType = func.acceptValueType.values().next().value;
    if (!firstAcceptValueType) {
      return err(
        domainError.unexpected({ message: `function ${func.name} has no acceptable value types` })
      );
    }

    return ok(
      new TypedValue(
        normalized.value,
        firstAcceptValueType,
        normalized.isMultiple,
        normalized.field,
        normalized.isBlank
      )
    );
  }
}
