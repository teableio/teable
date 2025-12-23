import type { BinaryOpContext, FieldReferenceCurlyContext } from '@teable/formula';
import { CharStreams, CommonTokenStream, Formula, FormulaLexer } from '@teable/formula';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

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
    expect(sameType.isOk()).toBe(true);
    if (sameType.isErr()) return;
    expect(sameType.value.type).toBe(CellValueType.String);

    const converted = converter.convertTypedValue(
      new TypedValue(1, CellValueType.Number),
      new Concatenate()
    );
    expect(converted.isOk()).toBe(true);
    if (converted.isErr()) return;
    expect(converted.value.type).toBe(CellValueType.String);

    const emptyAccept = converter.convertTypedValue(
      new TypedValue(1, CellValueType.Number),
      new Today()
    );
    expect(emptyAccept.isErr()).toBe(true);
  });

  describe('FormulaTypeVisitor', () => {
    it('infers binary operator types', () => {
      const visitor = new FormulaTypeVisitor({});

      const numberPlus = parseRoot('1 + 2').accept(visitor);
      expect(numberPlus.isOk()).toBe(true);
      if (numberPlus.isErr()) return;
      expect(numberPlus.value.type).toBe(CellValueType.Number);

      const stringPlus = parseRoot('"a" + 1').accept(visitor);
      expect(stringPlus.isOk()).toBe(true);
      if (stringPlus.isErr()) return;
      expect(stringPlus.value.type).toBe(CellValueType.String);

      const minus = parseRoot('1 - 2').accept(visitor);
      expect(minus.isOk()).toBe(true);
      if (minus.isErr()) return;
      expect(minus.value.type).toBe(CellValueType.Number);

      const comparison = parseRoot('1 > 0').accept(visitor);
      expect(comparison.isOk()).toBe(true);
      if (comparison.isErr()) return;
      expect(comparison.value.type).toBe(CellValueType.Boolean);

      const ampersand = parseRoot('"a" & "b"').accept(visitor);
      expect(ampersand.isOk()).toBe(true);
      if (ampersand.isErr()) return;
      expect(ampersand.value.type).toBe(CellValueType.String);

      const brackets = parseRoot('(1)').accept(visitor);
      expect(brackets.isOk()).toBe(true);
      if (brackets.isErr()) return;
      expect(brackets.value.type).toBe(CellValueType.Number);

      const unary = parseRoot('-1').accept(visitor);
      expect(unary.isOk()).toBe(true);
      if (unary.isErr()) return;
      expect(unary.value.type).toBe(CellValueType.Number);

      const decimal = parseRoot('1.5').accept(visitor);
      expect(decimal.isOk()).toBe(true);
      if (decimal.isErr()) return;
      expect(decimal.value.type).toBe(CellValueType.Number);

      const booleanLiteral = parseRoot('TRUE').accept(visitor);
      expect(booleanLiteral.isOk()).toBe(true);
      if (booleanLiteral.isErr()) return;
      expect(booleanLiteral.value.type).toBe(CellValueType.Boolean);
    });

    it('resolves field references and handles missing fields', () => {
      const visitorWithDeps = new FormulaTypeVisitor(dependencies);
      const reference = parseRoot(`{${fieldId}}`).accept(visitorWithDeps);
      expect(reference.isOk()).toBe(true);
      if (reference.isErr()) return;
      expect(reference.value.type).toBe(CellValueType.Number);
      expect(reference.value.isMultiple).toBe(false);

      const missing = parseRoot(`{${fieldId}}`).accept(new FormulaTypeVisitor({}));
      expect(missing.isErr()).toBe(true);
      if (missing.isErr()) {
        expect(missing.error).toContain(`FieldId ${fieldId} is a invalid field id`);
      }

      const invalidContext = {
        IDENTIFIER_VARIABLE: () => undefined,
      } as unknown as FieldReferenceCurlyContext;
      const invalid = visitorWithDeps.visitFieldReferenceCurly(invalidContext);
      expect(invalid.isErr()).toBe(true);
      if (invalid.isErr()) {
        expect(invalid.error).toContain('FieldId {} is a invalid field id');
      }
    });

    it('handles function calls and aliases', () => {
      const visitor = new FormulaTypeVisitor({});

      const blank = parseRoot('BLANK()').accept(visitor);
      expect(blank.isOk()).toBe(true);
      if (blank.isErr()) return;
      expect(blank.value.isBlank).toBe(true);

      const alias = parseRoot('ARRAYJOIN("a")').accept(visitor);
      expect(alias.isOk()).toBe(true);
      if (alias.isErr()) return;
      expect(alias.value.type).toBe(CellValueType.String);

      const isError = parseRoot(`IS_ERROR({${fieldId}})`).accept(visitor);
      expect(isError.isOk()).toBe(true);
      if (isError.isErr()) return;
      expect(isError.value.type).toBe(CellValueType.Boolean);

      const unknown = parseRoot('UNKNOWN()').accept(visitor);
      expect(unknown.isErr()).toBe(true);
      if (unknown.isErr()) {
        expect(unknown.error).toContain('Function name UNKNOWN is not found');
      }

      const sumMissing = parseRoot(`SUM({${fieldId}})`).accept(visitor);
      expect(sumMissing.isErr()).toBe(true);
      if (sumMissing.isErr()) {
        expect(sumMissing.error).toContain(`FieldId ${fieldId} is a invalid field id`);
      }

      const invalidParam = parseRoot('TODAY(1)').accept(visitor);
      expect(invalidParam.isErr()).toBe(true);
      if (invalidParam.isErr()) {
        expect(invalidParam.error).toContain('no acceptable value types');
      }
    });

    it('propagates expression errors in unary, binary, and return types', () => {
      const visitor = new FormulaTypeVisitor({});

      const unaryError = parseRoot(`-{${fieldId}}`).accept(visitor);
      expect(unaryError.isErr()).toBe(true);

      const binaryLeftError = parseRoot(`{${fieldId}} + 1`).accept(visitor);
      expect(binaryLeftError.isErr()).toBe(true);

      const binaryRightError = parseRoot(`1 + {${fieldId}}`).accept(visitor);
      expect(binaryRightError.isErr()).toBe(true);

      const returnTypeError = parseRoot('SUM()').accept(visitor);
      expect(returnTypeError.isErr()).toBe(true);
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
        visitor as unknown as { defaultResult: () => Result<TypedValue, string> }
      ).defaultResult();
      expect(defaultResult.isOk()).toBe(true);
      if (defaultResult.isErr()) return;
      expect(defaultResult.value.type).toBe(CellValueType.String);
    });
  });
});
