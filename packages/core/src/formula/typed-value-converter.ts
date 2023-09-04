import { CellValueType } from '../models/field/constant';
import type { FormulaFunc } from './functions/common';
import { TypedValue } from './typed-value';

export class TypedValueConverter {
  // auto transform an array value to non-array value if only have 1 item
  transformMultipleValue(typedValue: TypedValue, func: FormulaFunc): TypedValue {
    const { value, type, isMultiple } = typedValue;
    if (!isMultiple || func.acceptMultipleValue) {
      return typedValue;
    }

    if (value?.length > 1) {
      console.log(func);
      throw new TypeError(`function ${func.name} is not accept array value: ${value}`);
    }
    const transValue = value && value[0];
    return new TypedValue(transValue, type);
  }

  // convert typed value to function first accept value type
  convertTypedValue(typedValue: TypedValue, func: FormulaFunc): TypedValue {
    typedValue = this.transformMultipleValue(typedValue, func);

    if (func.acceptValueType.has(typedValue.type)) {
      return typedValue;
    }

    const firstAcceptValueType = func.acceptValueType.values().next().value;

    const converted = typedValue.isMultiple
      ? (typedValue.value as unknown[])?.map((v) =>
          this.convertUnsupportedValue(v, typedValue.type, firstAcceptValueType)
        )
      : this.convertUnsupportedValue(typedValue.value, typedValue.type, firstAcceptValueType);

    return new TypedValue(
      converted == null ? null : converted,
      firstAcceptValueType,
      typedValue.isMultiple
    );
  }

  private convertUnsupportedValue(
    value: unknown,
    inputValueType: CellValueType,
    acceptValueType: CellValueType
  ) {
    if (inputValueType === acceptValueType) {
      throw new Error('Should not convert an accept value type');
    }

    if (value == null) {
      return null;
    }

    switch (acceptValueType) {
      case CellValueType.DateTime:
        return this.convertDatetimeValue(value, inputValueType);
      case CellValueType.Number:
        return this.convertNumberValue(value, inputValueType);
      case CellValueType.Boolean:
        return this.convertBooleanValue(value, inputValueType);
      case CellValueType.String:
        return this.convertStringValue(value, inputValueType);
    }
  }

  private convertDatetimeValue(value: unknown, inputValueType: CellValueType) {
    switch (inputValueType) {
      case CellValueType.DateTime:
        return value;
      case CellValueType.String: {
        const date = new Date(value as string);
        if (!Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
        return null;
      }
      case CellValueType.Boolean:
      case CellValueType.Number:
        return null;
    }
  }

  private convertBooleanValue(value: unknown, inputValueType: CellValueType) {
    switch (inputValueType) {
      case CellValueType.Boolean:
        return value;
      case CellValueType.String:
      case CellValueType.Number:
      case CellValueType.DateTime:
        return Boolean(value);
    }
  }

  private convertNumberValue(value: unknown, inputValueType: CellValueType) {
    switch (inputValueType) {
      case CellValueType.Number:
        return value;
      case CellValueType.String: {
        const number = Number(value);
        if (Number.isNaN(number)) {
          return null;
        }
        return number;
      }
      case CellValueType.Boolean:
        return value ? 1 : 0;
      case CellValueType.DateTime:
        return null;
    }
  }

  private convertStringValue(value: unknown, inputValueType: CellValueType) {
    switch (inputValueType) {
      case CellValueType.String:
      case CellValueType.DateTime:
        return value;
      case CellValueType.Boolean:
      case CellValueType.Number:
        return String(value);
    }
  }
}
