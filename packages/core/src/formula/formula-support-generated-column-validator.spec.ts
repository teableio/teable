/* eslint-disable sonarjs/no-duplicate-string */
import { FieldType } from '../models/field/constant';
import type { FieldCore } from '../models/field/field';
import { FormulaSupportGeneratedColumnValidator } from './formula-support-generated-column-validator';
import type {
  IGeneratedColumnQuerySupportValidator,
  IFieldMap,
} from './function-convertor.interface';

// Mock support validator that returns true for all functions
class MockSupportValidator implements IGeneratedColumnQuerySupportValidator {
  setContext(): void {
    //
  }

  // Missing methods from ITeableToDbFunctionConverter
  stringConcat(): boolean {
    return true;
  }
  logicalAnd(): boolean {
    return true;
  }
  logicalOr(): boolean {
    return true;
  }
  bitwiseAnd(): boolean {
    return true;
  }
  unaryMinus(): boolean {
    return true;
  }
  encodeUrlComponent(): boolean {
    return true;
  }
  count(): boolean {
    return true;
  }
  countA(): boolean {
    return true;
  }
  countAll(): boolean {
    return true;
  }
  log10(): boolean {
    return true;
  }
  fieldReference(): boolean {
    return true;
  }
  stringLiteral(): boolean {
    return true;
  }
  numberLiteral(): boolean {
    return true;
  }
  booleanLiteral(): boolean {
    return true;
  }
  nullLiteral(): boolean {
    return true;
  }
  castToNumber(): boolean {
    return true;
  }
  castToString(): boolean {
    return true;
  }
  castToBoolean(): boolean {
    return true;
  }
  castToDate(): boolean {
    return true;
  }
  isNull(): boolean {
    return true;
  }
  coalesce(): boolean {
    return true;
  }
  parentheses(): boolean {
    return true;
  }

  // All methods return true for testing
  sum(): boolean {
    return true;
  }
  average(): boolean {
    return true;
  }
  max(): boolean {
    return true;
  }
  min(): boolean {
    return true;
  }
  round(): boolean {
    return true;
  }
  roundUp(): boolean {
    return true;
  }
  roundDown(): boolean {
    return true;
  }
  ceiling(): boolean {
    return true;
  }
  floor(): boolean {
    return true;
  }
  abs(): boolean {
    return true;
  }
  sqrt(): boolean {
    return true;
  }
  power(): boolean {
    return true;
  }
  exp(): boolean {
    return true;
  }
  log(): boolean {
    return true;
  }
  mod(): boolean {
    return true;
  }
  int(): boolean {
    return true;
  }
  even(): boolean {
    return true;
  }
  odd(): boolean {
    return true;
  }

  // Text functions
  concatenate(): boolean {
    return true;
  }
  find(): boolean {
    return true;
  }
  search(): boolean {
    return true;
  }
  mid(): boolean {
    return true;
  }
  left(): boolean {
    return true;
  }
  right(): boolean {
    return true;
  }
  replace(): boolean {
    return true;
  }
  regexpReplace(): boolean {
    return true;
  }
  substitute(): boolean {
    return true;
  }
  trim(): boolean {
    return true;
  }
  upper(): boolean {
    return true;
  }
  lower(): boolean {
    return true;
  }
  len(): boolean {
    return true;
  }
  t(): boolean {
    return true;
  }
  value(): boolean {
    return true;
  }
  rept(): boolean {
    return true;
  }
  exact(): boolean {
    return true;
  }
  regexpMatch(): boolean {
    return true;
  }
  regexpExtract(): boolean {
    return true;
  }

  // Date/Time functions
  now(): boolean {
    return true;
  }
  today(): boolean {
    return true;
  }
  dateAdd(): boolean {
    return true;
  }
  datestr(): boolean {
    return true;
  }
  datetimeDiff(): boolean {
    return true;
  }
  datetimeFormat(): boolean {
    return true;
  }
  datetimeParse(): boolean {
    return true;
  }
  day(): boolean {
    return true;
  }
  fromNow(): boolean {
    return true;
  }
  hour(): boolean {
    return true;
  }
  isAfter(): boolean {
    return true;
  }
  isBefore(): boolean {
    return true;
  }
  isSame(): boolean {
    return true;
  }
  minute(): boolean {
    return true;
  }
  month(): boolean {
    return true;
  }
  second(): boolean {
    return true;
  }
  timestr(): boolean {
    return true;
  }
  toNow(): boolean {
    return true;
  }
  weekNum(): boolean {
    return true;
  }
  weekday(): boolean {
    return true;
  }
  workday(): boolean {
    return true;
  }
  workdayDiff(): boolean {
    return true;
  }
  year(): boolean {
    return true;
  }
  createdTime(): boolean {
    return true;
  }
  lastModifiedTime(): boolean {
    return true;
  }

  // Logical functions
  if(): boolean {
    return true;
  }
  and(): boolean {
    return true;
  }
  or(): boolean {
    return true;
  }
  not(): boolean {
    return true;
  }
  xor(): boolean {
    return true;
  }
  blank(): boolean {
    return true;
  }
  error(): boolean {
    return true;
  }
  isError(): boolean {
    return true;
  }
  switch(): boolean {
    return true;
  }

  // Array functions
  arrayJoin(): boolean {
    return true;
  }
  arrayUnique(): boolean {
    return true;
  }
  arrayFlatten(): boolean {
    return true;
  }
  arrayCompact(): boolean {
    return true;
  }

  // System functions
  recordId(): boolean {
    return true;
  }
  autoNumber(): boolean {
    return true;
  }
  textAll(): boolean {
    return true;
  }

  // Comparison operators
  equal(): boolean {
    return true;
  }
  notEqual(): boolean {
    return true;
  }
  greaterThan(): boolean {
    return true;
  }
  lessThan(): boolean {
    return true;
  }
  greaterThanOrEqual(): boolean {
    return true;
  }
  lessThanOrEqual(): boolean {
    return true;
  }
  add(): boolean {
    return true;
  }
  subtract(): boolean {
    return true;
  }
  multiply(): boolean {
    return true;
  }
  divide(): boolean {
    return true;
  }
  modulo(): boolean {
    return true;
  }
}

// Mock field
function createMockField(id: string, type: FieldType, isLookup = false): FieldCore {
  return {
    id,
    type,
    isLookup,
  } as FieldCore;
}

// Mock formula field with expression
function createMockFormulaField(id: string, expression: string): FieldCore {
  return {
    id,
    type: FieldType.Formula,
    isLookup: false,
    getExpression: () => expression,
  } as unknown as FieldCore;
}

describe('FormulaSupportGeneratedColumnValidator', () => {
  let mockSupportValidator: MockSupportValidator;
  let fieldMap: IFieldMap;

  beforeEach(() => {
    mockSupportValidator = new MockSupportValidator();
    fieldMap = new Map();
  });

  describe('validateFormula', () => {
    it('should return true for simple numeric expression', () => {
      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator);
      expect(validator.validateFormula('1 + 2')).toBe(true);
    });

    it('should return true for supported function', () => {
      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator);
      expect(validator.validateFormula('SUM(1, 2, 3)')).toBe(true);
    });

    it('should return false for invalid expression', () => {
      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator);
      expect(validator.validateFormula('INVALID_SYNTAX(')).toBe(false);
    });
  });

  describe('field reference validation', () => {
    it('should return true when no fieldMap is provided', () => {
      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator);
      expect(validator.validateFormula('{field1} + 1')).toBe(true);
    });

    it('should return false when referencing non-existent field', () => {
      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{nonExistentField}')).toBe(false);
    });

    it('should return true when referencing supported field types', () => {
      fieldMap.set('textField', createMockField('textField', FieldType.SingleLineText));
      fieldMap.set('numberField', createMockField('numberField', FieldType.Number));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{textField} + {numberField}')).toBe(true);
    });

    it('should return false when directly referencing link field', () => {
      fieldMap.set('linkField', createMockField('linkField', FieldType.Link));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{linkField}')).toBe(false);
    });

    it('should return false when directly referencing lookup field', () => {
      fieldMap.set('lookupField', createMockField('lookupField', FieldType.SingleLineText, true));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{lookupField}')).toBe(false);
    });

    it('should return false when directly referencing rollup field', () => {
      fieldMap.set('rollupField', createMockField('rollupField', FieldType.Rollup));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{rollupField}')).toBe(false);
    });

    // Test recursive field reference validation
    it('should return false when formula field indirectly references link field', () => {
      fieldMap.set('linkField', createMockField('linkField', FieldType.Link));
      fieldMap.set('formula2', createMockFormulaField('formula2', '{linkField}'));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{formula2} + 1')).toBe(false);
    });

    it('should return false when formula field indirectly references lookup field', () => {
      fieldMap.set('lookupField', createMockField('lookupField', FieldType.SingleLineText, true));
      fieldMap.set('formula2', createMockFormulaField('formula2', '{lookupField}'));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{formula2} + 1')).toBe(false);
    });

    it('should return false when formula field indirectly references rollup field', () => {
      fieldMap.set('rollupField', createMockField('rollupField', FieldType.Rollup));
      fieldMap.set('formula2', createMockFormulaField('formula2', '{rollupField}'));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{formula2} + 1')).toBe(false);
    });

    it('should return false with multi-level formula chain referencing link field', () => {
      fieldMap.set('linkField', createMockField('linkField', FieldType.Link));
      fieldMap.set('formula3', createMockFormulaField('formula3', '{linkField}'));
      fieldMap.set('formula2', createMockFormulaField('formula2', '{formula3}'));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{formula2} + 1')).toBe(false);
    });

    it('should return true when formula field references only supported fields', () => {
      fieldMap.set('textField', createMockField('textField', FieldType.SingleLineText));
      fieldMap.set('formula2', createMockFormulaField('formula2', '{textField}'));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{formula2} + 1')).toBe(true);
    });

    it('should handle circular references without infinite recursion', () => {
      fieldMap.set('formula1', createMockFormulaField('formula1', '{formula2}'));
      fieldMap.set('formula2', createMockFormulaField('formula2', '{formula1}'));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      // Should not throw an error and should return true (no unsupported fields in the cycle)
      expect(validator.validateFormula('{formula1}')).toBe(true);
    });

    it('should handle circular references with unsupported field', () => {
      fieldMap.set('linkField', createMockField('linkField', FieldType.Link));
      fieldMap.set('formula1', createMockFormulaField('formula1', '{formula2} + {linkField}'));
      fieldMap.set('formula2', createMockFormulaField('formula2', '{formula1}'));

      const validator = new FormulaSupportGeneratedColumnValidator(mockSupportValidator, fieldMap);
      expect(validator.validateFormula('{formula1}')).toBe(false);
    });
  });
});
