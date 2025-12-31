import type { BinaryOpContext, FieldReferenceCurlyContext } from '@teable/formula';
import { CharStreams, CommonTokenStream, Formula, FormulaLexer } from '@teable/formula';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { DomainError } from '../shared/DomainError';
import { CellValueType } from './CellValueType';
import { normalizeFunctionNameAlias } from './function-aliases';
import { FunctionName } from './functions/common';
import { Today } from './functions/date-time';
import { Round, Sum } from './functions/numeric';
import { Concatenate } from './functions/text';
import { TypedValue } from './typed-value';
import { TypedValueConverter } from './typed-value-converter';
import { FormulaTypeVisitor } from './visitor';
import * as formulaIndex from './index';

const parseRoot = (expression: string) => {
  const inputStream = CharStreams.fromString(expression);
  const lexer = new FormulaLexer(inputStream);
  const tokenStream = new CommonTokenStream(lexer);
  const parser = new Formula(tokenStream);
  return parser.root();
};

const fieldId = `fld${'a'.repeat(16)}`;
const dependencies = {
  [fieldId]: {
    id: fieldId,
    cellValueType: CellValueType.Number,
    isMultipleCellValue: false,
  },
};

describe('formula basics', () => {
  it('re-exports formula types', () => {
    expect(formulaIndex).toHaveProperty('CellValueType');
    expect(formulaIndex).toHaveProperty('FormulaTypeVisitor');
    expect(formulaIndex).toHaveProperty('FunctionName');
    expect(formulaIndex).toHaveProperty('FormulaFuncType');
  });

  it('normalizes function name aliases', () => {
    expect(normalizeFunctionNameAlias('ARRAYJOIN')).toBe(FunctionName.ArrayJoin);
    expect(normalizeFunctionNameAlias('MISSING')).toBe('MISSING');
  });

  it('converts typed values to plain values', () => {
    const falsy = new TypedValue(false, CellValueType.Boolean);
    expect(falsy.toPlain()).toBeNull();
    const zero = new TypedValue(0, CellValueType.Number);
    expect(zero.toPlain()).toBe(0);
  });

  it('converts typed values for formula functions', () => {
    const converter = new TypedValueConverter();
    const multi = new TypedValue(1, CellValueType.Number, true);
    const round = new Round();
    const sum = new Sum();

    const normalized = converter.transformMultipleValue(multi, round);
    expect(normalized.isMultiple).toBe(false);
    const unchanged = converter.transformMultipleValue(multi, sum);
    expect(unchanged.isMultiple).toBe(true);

    const sameType = converter.convertTypedValue(
      new TypedValue('text', CellValueType.String),
      new Concatenate()
    );
    const sameTypeValue = sameType._unsafeUnwrap();
    expect(sameTypeValue.type).toBe(CellValueType.String);

    const converted = converter.convertTypedValue(
      new TypedValue(1, CellValueType.Number),
      new Concatenate()
    );
    const convertedValue = converted._unsafeUnwrap();
    expect(convertedValue.type).toBe(CellValueType.String);

    const emptyAccept = converter.convertTypedValue(
      new TypedValue(1, CellValueType.Number),
      new Today()
    );
    emptyAccept._unsafeUnwrapErr();
  });

  describe('FormulaTypeVisitor', () => {
    it('infers binary operator types', () => {
      const visitor = new FormulaTypeVisitor({});

      const numberPlus = parseRoot('1 + 2').accept(visitor);
      const numberPlusValue = numberPlus._unsafeUnwrap();
      expect(numberPlusValue.type).toBe(CellValueType.Number);

      const stringPlus = parseRoot('"a" + 1').accept(visitor);
      const stringPlusValue = stringPlus._unsafeUnwrap();
      expect(stringPlusValue.type).toBe(CellValueType.String);

      const minus = parseRoot('1 - 2').accept(visitor);
      const minusValue = minus._unsafeUnwrap();
      expect(minusValue.type).toBe(CellValueType.Number);

      const comparison = parseRoot('1 > 0').accept(visitor);
      const comparisonValue = comparison._unsafeUnwrap();
      expect(comparisonValue.type).toBe(CellValueType.Boolean);

      const ampersand = parseRoot('"a" & "b"').accept(visitor);
      const ampersandValue = ampersand._unsafeUnwrap();
      expect(ampersandValue.type).toBe(CellValueType.String);

      const brackets = parseRoot('(1)').accept(visitor);
      const bracketsValue = brackets._unsafeUnwrap();
      expect(bracketsValue.type).toBe(CellValueType.Number);

      const unary = parseRoot('-1').accept(visitor);
      const unaryValue = unary._unsafeUnwrap();
      expect(unaryValue.type).toBe(CellValueType.Number);

      const decimal = parseRoot('1.5').accept(visitor);
      const decimalValue = decimal._unsafeUnwrap();
      expect(decimalValue.type).toBe(CellValueType.Number);

      const booleanLiteral = parseRoot('TRUE').accept(visitor);
      const booleanLiteralValue = booleanLiteral._unsafeUnwrap();
      expect(booleanLiteralValue.type).toBe(CellValueType.Boolean);
    });

    it('resolves field references and handles missing fields', () => {
      const visitorWithDeps = new FormulaTypeVisitor(dependencies);
      const reference = parseRoot(`{${fieldId}}`).accept(visitorWithDeps);
      const referenceValue = reference._unsafeUnwrap();
      expect(referenceValue.type).toBe(CellValueType.Number);
      expect(referenceValue.isMultiple).toBe(false);

      const missing = parseRoot(`{${fieldId}}`).accept(new FormulaTypeVisitor({}));
      missing._unsafeUnwrapErr();
      expect(missing._unsafeUnwrapErr().message).toContain(
        `FieldId ${fieldId} is a invalid field id`
      );

      const invalidContext = {
        IDENTIFIER_VARIABLE: () => undefined,
      } as unknown as FieldReferenceCurlyContext;
      const invalid = visitorWithDeps.visitFieldReferenceCurly(invalidContext);
      invalid._unsafeUnwrapErr();
      expect(invalid._unsafeUnwrapErr().message).toContain('FieldId {} is a invalid field id');
    });

    it('handles function calls and aliases', () => {
      const visitor = new FormulaTypeVisitor({});

      const blank = parseRoot('BLANK()').accept(visitor);
      const blankValue = blank._unsafeUnwrap();
      expect(blankValue.isBlank).toBe(true);

      const alias = parseRoot('ARRAYJOIN("a")').accept(visitor);
      const aliasValue = alias._unsafeUnwrap();
      expect(aliasValue.type).toBe(CellValueType.String);

      const isError = parseRoot(`IS_ERROR({${fieldId}})`).accept(visitor);
      const isErrorValue = isError._unsafeUnwrap();
      expect(isErrorValue.type).toBe(CellValueType.Boolean);

      const unknown = parseRoot('UNKNOWN()').accept(visitor);
      unknown._unsafeUnwrapErr();
      expect(unknown._unsafeUnwrapErr().message).toContain('Function name UNKNOWN is not found');

      const sumMissing = parseRoot(`SUM({${fieldId}})`).accept(visitor);
      sumMissing._unsafeUnwrapErr();
      expect(sumMissing._unsafeUnwrapErr().message).toContain(
        `FieldId ${fieldId} is a invalid field id`
      );

      const invalidParam = parseRoot('TODAY(1)').accept(visitor);
      invalidParam._unsafeUnwrapErr();
      expect(invalidParam._unsafeUnwrapErr().message).toContain('no acceptable value types');
    });

    it('propagates expression errors in unary, binary, and return types', () => {
      const visitor = new FormulaTypeVisitor({});

      const unaryError = parseRoot(`-{${fieldId}}`).accept(visitor);
      unaryError._unsafeUnwrapErr();

      const binaryLeftError = parseRoot(`{${fieldId}} + 1`).accept(visitor);
      binaryLeftError._unsafeUnwrapErr();

      const binaryRightError = parseRoot(`1 + {${fieldId}}`).accept(visitor);
      binaryRightError._unsafeUnwrapErr();

      const returnTypeError = parseRoot('SUM()').accept(visitor);
      returnTypeError._unsafeUnwrapErr();
    });

    it('falls back to string for unsupported binary operators', () => {
      const visitor = new FormulaTypeVisitor({});
      const getBinaryOpValueType = (
        visitor as unknown as {
          getBinaryOpValueType: (
            ctx: BinaryOpContext,
            left: TypedValue,
            right: TypedValue
          ) => CellValueType;
        }
      ).getBinaryOpValueType;
      const fakeContext = {
        PLUS: () => null,
        MINUS: () => null,
        STAR: () => null,
        PERCENT: () => null,
        SLASH: () => null,
        PIPE_PIPE: () => null,
        AMP_AMP: () => null,
        EQUAL: () => null,
        BANG_EQUAL: () => null,
        GT: () => null,
        GTE: () => null,
        LT: () => null,
        LTE: () => null,
        AMP: () => null,
      } as unknown as BinaryOpContext;

      const result = getBinaryOpValueType(
        fakeContext,
        new TypedValue(1, CellValueType.Number),
        new TypedValue(1, CellValueType.Number)
      );
      expect(result).toBe(CellValueType.String);
    });

    it('exposes a default result type', () => {
      const visitor = new FormulaTypeVisitor({});
      const defaultResult = (
        visitor as unknown as { defaultResult: () => Result<TypedValue, DomainError> }
      ).defaultResult();
      defaultResult._unsafeUnwrap();

      expect(defaultResult._unsafeUnwrap().type).toBe(CellValueType.String);
    });
  });
});
