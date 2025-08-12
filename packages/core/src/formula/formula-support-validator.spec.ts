import { FieldType } from '../models/field/constant';
import type { FieldCore } from '../models/field/field';
import { FormulaSupportValidator } from './formula-support-validator';
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
  even(): boolean {
    return true;
  }
  odd(): boolean {
    return true;
  }
  int(): boolean {
    return true;
  }
  value(): boolean {
    return true;
  }
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
  rept(): boolean {
    return true;
  }
  len(): boolean {
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
  t(): boolean {
    return true;
  }
  encodeUrlComponent(): boolean {
    return true;
  }
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
  count(): boolean {
    return true;
  }
  countA(): boolean {
    return true;
  }
  countAll(): boolean {
    return true;
  }
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
  recordId(): boolean {
    return true;
  }
  autoNumber(): boolean {
    return true;
  }
  textAll(): boolean {
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
  fieldReference(): boolean {
    return true;
  }
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

describe('FormulaSupportValidator', () => {
  let mockSupportValidator: MockSupportValidator;
  let fieldMap: IFieldMap;

  beforeEach(() => {
    mockSupportValidator = new MockSupportValidator();
    fieldMap = new Map();
  });

  describe('validateFormula with field references', () => {
    it('should return true for formula without field references', () => {
      const validator = new FormulaSupportValidator(mockSupportValidator, fieldMap);
      const result = validator.validateFormula('1 + 1');
      expect(result).toBe(true);
    });

    it('should return true for formula referencing regular fields', () => {
      const textField = createMockField('fld1', FieldType.SingleLineText);
      const numberField = createMockField('fld2', FieldType.Number);
      fieldMap.set('fld1', textField);
      fieldMap.set('fld2', numberField);

      const validator = new FormulaSupportValidator(mockSupportValidator, fieldMap);
      const result = validator.validateFormula('{fld1} + {fld2}');
      expect(result).toBe(true);
    });

    it('should return false for formula referencing link field', () => {
      const linkField = createMockField('fld1', FieldType.Link);
      fieldMap.set('fld1', linkField);

      const validator = new FormulaSupportValidator(mockSupportValidator, fieldMap);
      const result = validator.validateFormula('{fld1}');
      expect(result).toBe(false);
    });

    it('should return false for formula referencing rollup field', () => {
      const rollupField = createMockField('fld1', FieldType.Rollup);
      fieldMap.set('fld1', rollupField);

      const validator = new FormulaSupportValidator(mockSupportValidator, fieldMap);
      const result = validator.validateFormula('{fld1}');
      expect(result).toBe(false);
    });

    it('should return false for formula referencing lookup field', () => {
      const lookupField = createMockField('fld1', FieldType.SingleLineText, true);
      fieldMap.set('fld1', lookupField);

      const validator = new FormulaSupportValidator(mockSupportValidator, fieldMap);
      const result = validator.validateFormula('{fld1}');
      expect(result).toBe(false);
    });

    it('should return false for formula referencing multiple fields including link', () => {
      const textField = createMockField('fld1', FieldType.SingleLineText);
      const linkField = createMockField('fld2', FieldType.Link);
      fieldMap.set('fld1', textField);
      fieldMap.set('fld2', linkField);

      const validator = new FormulaSupportValidator(mockSupportValidator, fieldMap);
      const result = validator.validateFormula('{fld1} + {fld2}');
      expect(result).toBe(false);
    });

    it('should return false for formula referencing non-existent field', () => {
      const validator = new FormulaSupportValidator(mockSupportValidator, fieldMap);
      const result = validator.validateFormula('{nonexistent}');
      expect(result).toBe(false);
    });

    it('should work without fieldMap (backward compatibility)', () => {
      const validator = new FormulaSupportValidator(mockSupportValidator);
      const result = validator.validateFormula('1 + 1');
      expect(result).toBe(true);
    });
  });
});
