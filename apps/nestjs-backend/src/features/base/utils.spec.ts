import { replaceExpressionFieldIds, replaceJsonStringFieldIds } from './utils';

describe('replaceFieldIds function', () => {
  it('replaces fieldIds in the expression with their mapped values', () => {
    const old2NewFieldMap = {
      fld123: 'newFld456',
      fld789: 'newFld101112',
    };
    const expression = 'This is a test with {fld123} and also {fld789}.';
    const expectedResult = 'This is a test with {newFld456} and also {newFld101112}.';

    expect(replaceExpressionFieldIds(expression, old2NewFieldMap)).toEqual(expectedResult);
  });

  it('does not replace non-existent fieldIds', () => {
    const old2NewFieldMap = {
      fld123: 'newFld456',
    };
    const expression = 'This is a test with {fld123} and also {fldNonExistent}.';
    const expectedResult = 'This is a test with {newFld456} and also {fldNonExistent}.';

    expect(replaceExpressionFieldIds(expression, old2NewFieldMap)).toEqual(expectedResult);
  });

  it('correctly ignores invalid fieldId formats', () => {
    const old2NewFieldMap = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      '1fldInvalid': 'newFld456',
    };
    const expression = 'Check {1fldInvalid} and {fld123}.';
    const expectedResult = 'Check {1fldInvalid} and {fld123}.'; // Assuming fld123 is not in the map, and 1fldInvalid is ignored due to invalid format

    expect(replaceExpressionFieldIds(expression, old2NewFieldMap)).toEqual(expectedResult);
  });
});

describe('replaceJsonStringFieldIds', () => {
  it('should replace fieldIds in jsonString correctly', () => {
    const jsonString =
      '{"exampleFieldId": "fld1234567890abcdef", "nested": {"fld234567890abcdefg": "someValue"}}';
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldNew1234567890abcd',
      fld234567890abcdefg: 'fldNew234567890abcde',
    };

    const expectedResult =
      '{"exampleFieldId": "fldNew1234567890abcd", "nested": {"fldNew234567890abcde": "someValue"}}';

    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);

    expect(result).toBe(expectedResult);
  });

  it('should not modify jsonString if no fieldIds match', () => {
    const jsonString = '{"unrelatedKey": "unrelatedValue", "anotherKey": 123}';
    const old2NewFieldMap = {
      fldDoesNotExist: 'fldNewValue',
    };
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(jsonString);
  });

  it('should handle jsonString with empty fieldId map', () => {
    const jsonString = '{"exampleFieldId": "fld1234567890abcdef"}';
    const old2NewFieldMap = {};
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(jsonString); // Expect no change since the map is empty
  });

  it('should correctly replace fieldIds when they appear as values', () => {
    const jsonString = '{"key": "fld1234567890abcdef"}';
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldReplacement',
    };
    const expectedResult = '{"key": "fldReplacement"}';
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(expectedResult);
  });

  it('should correctly replace fieldIds when they appear as keys', () => {
    const jsonString = '{"fld1234567890abcdef": "someValue"}';
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldNewKey',
    };
    const expectedResult = '{"fldNewKey": "someValue"}';
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(expectedResult);
  });

  it('should handle jsonString with multiple and nested fieldIds', () => {
    const jsonString =
      '{"fld1234567890abcdef": "value1", "nested": {"fld4561237890abcdef": "value2"}}';
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldNew4567890abcdef',
      fld4561237890abcdef: 'fldNew1237890abcdef',
    };
    const expectedResult =
      '{"fldNew4567890abcdef": "value1", "nested": {"fldNew1237890abcdef": "value2"}}';
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(expectedResult);
  });

  it('should return original jsonString for empty input', () => {
    const jsonString = '';
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldReplacement',
    };
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(jsonString);
  });

  it('should return null jsonString for null input', () => {
    const jsonString = null;
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldReplacement',
    };
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(null);
  });
});
