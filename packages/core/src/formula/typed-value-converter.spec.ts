/* eslint-disable @typescript-eslint/no-explicit-any */
import { CellValueType } from '../models/field/constant';
import type { FormulaFunc } from './functions/common';
import { TypedValue } from './typed-value';
import { TypedValueConverter } from './typed-value-converter';

describe('TypedValueConverter', () => {
  const typedValueConverter = new TypedValueConverter();

  // Assuming a FormulaFunc implementation that accepts all types
  const funcAcceptAll = {
    name: 'testFunc',
    acceptValueType: new Set(Object.values(CellValueType)),
  } as any as FormulaFunc;

  // Assuming a FormulaFunc implementation that accepts only strings
  const funcAcceptString = {
    name: 'testFunc',
    acceptValueType: new Set([CellValueType.String]),
  } as any;

  // Test transformMultipleValue method
  it('should transform multiple values to single value', () => {
    const arrayValue = new TypedValue([42], CellValueType.Number, true);
    const transformed = typedValueConverter.transformMultipleValue(arrayValue, funcAcceptAll);
    expect(transformed.isMultiple).toBeUndefined();
    expect(transformed.value).toBe(42);
  });

  it('should throw error if function does not accept multiple values', () => {
    const arrayValue = new TypedValue([42, 24], CellValueType.Number, true);
    expect(() =>
      typedValueConverter.transformMultipleValue(arrayValue, funcAcceptAll)
    ).toThrowError(TypeError);
  });

  // Test convertTypedValue method
  it('should not convert null', () => {
    const strValue = new TypedValue(null, CellValueType.Number, true);
    const converted = typedValueConverter.convertTypedValue(strValue, {
      name: 'testFunc',
      acceptValueType: new Set([CellValueType.String]),
      acceptMultipleValue: true,
    } as any);
    expect(converted.type).toBe(CellValueType.String);
    expect(converted.value).toBe(null);
  });

  it('should not convert if function accepts input type', () => {
    const strValue = new TypedValue('test', CellValueType.String);
    const converted = typedValueConverter.convertTypedValue(strValue, funcAcceptString);
    expect(converted).toBe(strValue);
  });

  it('should convert boolean values to strings', () => {
    const boolValue = new TypedValue(true, CellValueType.Boolean);
    const converted = typedValueConverter.convertTypedValue(boolValue, funcAcceptString);
    expect(converted.type).toBe(CellValueType.String);
    expect(converted.value).toBe('true');
  });

  it('should convert number values to strings', () => {
    const numValue = new TypedValue(42, CellValueType.Number);
    const converted = typedValueConverter.convertTypedValue(numValue, funcAcceptString);
    expect(converted.type).toBe(CellValueType.String);
    expect(converted.value).toBe('42');
  });

  it('should convert boolean arrays to string arrays', () => {
    const boolValues = new TypedValue([true, false], CellValueType.Boolean, true);
    const converted = typedValueConverter.convertTypedValue(boolValues, {
      ...funcAcceptString,
      acceptMultipleValue: true,
    });
    expect(converted.type).toBe(CellValueType.String);
    expect(converted.isMultiple).toBe(true);
    expect(converted.value).toEqual(['true', 'false']);
  });

  it('should throw error when not accept array value', () => {
    const boolValues = new TypedValue([true, false], CellValueType.Boolean, true);
    expect(() =>
      typedValueConverter.convertTypedValue(boolValues, funcAcceptString)
    ).toThrowError();
  });

  // Test convertUnsupportedValue method
  it('should convert string to boolean', () => {
    const converted = typedValueConverter['convertUnsupportedValue'](
      'true',
      CellValueType.String,
      CellValueType.Boolean
    );
    expect(converted).toBe(true);
  });

  it('should convert string to number', () => {
    const converted = typedValueConverter['convertUnsupportedValue'](
      '42',
      CellValueType.String,
      CellValueType.Number
    );
    expect(converted).toBe(42);
  });

  // Test convertUnsupportedValue method
  it('should convert datetime value to string', () => {
    const date = new Date();
    const converted = typedValueConverter['convertUnsupportedValue'](
      date.toISOString(),
      CellValueType.DateTime,
      CellValueType.String
    );
    expect(converted).toBe(date.toISOString());
  });

  it('should convert boolean value to string', () => {
    const converted = typedValueConverter['convertUnsupportedValue'](
      true,
      CellValueType.Boolean,
      CellValueType.String
    );
    expect(converted).toBe('true');
  });

  it('should convert number value to string', () => {
    const converted = typedValueConverter['convertUnsupportedValue'](
      42,
      CellValueType.Number,
      CellValueType.String
    );
    expect(converted).toBe('42');
  });

  it('should convert boolean value to number', () => {
    const converted = typedValueConverter['convertUnsupportedValue'](
      true,
      CellValueType.Boolean,
      CellValueType.Number
    );
    expect(converted).toBe(1);
  });

  it('should convert string value to number', () => {
    const converted = typedValueConverter['convertUnsupportedValue'](
      '42',
      CellValueType.String,
      CellValueType.Number
    );
    expect(converted).toBe(42);
  });

  it('should convert string value to boolean', () => {
    const converted = typedValueConverter['convertUnsupportedValue'](
      '',
      CellValueType.String,
      CellValueType.Boolean
    );
    expect(converted).toBe(false);
  });

  it('should convert number value to boolean', () => {
    const converted = typedValueConverter['convertUnsupportedValue'](
      0,
      CellValueType.Number,
      CellValueType.Boolean
    );
    expect(converted).toBe(false);
  });

  // Test convertTypedValue method
  it('should convert string value to boolean', () => {
    const stringValue = new TypedValue('true', CellValueType.String);
    const funcAcceptBoolean = {
      ...funcAcceptString,
      acceptValueType: new Set([CellValueType.Boolean]),
    };
    const converted = typedValueConverter.convertTypedValue(stringValue, funcAcceptBoolean);
    expect(converted.type).toBe(CellValueType.Boolean);
    expect(converted.value).toBe(true);
  });

  it('should convert number value to boolean', () => {
    const numberValue = new TypedValue(1, CellValueType.Number);
    const funcAcceptBoolean = {
      ...funcAcceptString,
      acceptValueType: new Set([CellValueType.Boolean]),
    };
    const converted = typedValueConverter.convertTypedValue(numberValue, funcAcceptBoolean);
    expect(converted.type).toBe(CellValueType.Boolean);
    expect(converted.value).toBe(true);
  });
});
