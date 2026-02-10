import type {
  ANTLRErrorListener,
  ATNSimulator,
  ExprContext,
  Recognizer,
  RecognitionException,
  Token,
} from '@teable/formula';
import { CharStreams, CommonTokenStream, Formula, FormulaLexer } from '@teable/formula';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { CellValueType as FormulaCellValueType } from '../../../formula/CellValueType';
import type { FormulaFieldReference } from '../../../formula/FormulaFieldReference';
import { FormulaTypeVisitor } from '../../../formula/visitor';
import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';

export const ROLLUP_FUNCTIONS = [
  'countall({values})',
  'counta({values})',
  'count({values})',
  'sum({values})',
  'average({values})',
  'max({values})',
  'min({values})',
  'and({values})',
  'or({values})',
  'xor({values})',
  'array_join({values})',
  'array_unique({values})',
  'array_compact({values})',
  'concatenate({values})',
] as const;

export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number];

const BASE_ROLLUP_FUNCTIONS: RollupFunction[] = [
  'countall({values})',
  'counta({values})',
  'count({values})',
  'array_join({values})',
  'array_unique({values})',
  'array_compact({values})',
  'concatenate({values})',
];

const NUMBER_ROLLUP_FUNCTIONS: RollupFunction[] = [
  'sum({values})',
  'average({values})',
  'max({values})',
  'min({values})',
];

const DATETIME_ROLLUP_FUNCTIONS: RollupFunction[] = ['max({values})', 'min({values})'];

const BOOLEAN_ROLLUP_FUNCTIONS: RollupFunction[] = [
  'and({values})',
  'or({values})',
  'xor({values})',
];

export const getRollupFunctionsByCellValueType = (
  cellValueType: CellValueType
): ReadonlyArray<RollupFunction> => {
  const allowed = new Set<RollupFunction>(BASE_ROLLUP_FUNCTIONS);

  switch (cellValueType.toString()) {
    case 'number':
      NUMBER_ROLLUP_FUNCTIONS.forEach((fn) => allowed.add(fn));
      break;
    case 'dateTime':
      DATETIME_ROLLUP_FUNCTIONS.forEach((fn) => allowed.add(fn));
      break;
    case 'boolean':
      BOOLEAN_ROLLUP_FUNCTIONS.forEach((fn) => allowed.add(fn));
      break;
    case 'string':
    default:
      break;
  }

  return ROLLUP_FUNCTIONS.filter((fn) => allowed.has(fn));
};

export const isRollupFunctionSupportedForCellValueType = (
  expression: RollupFunction,
  cellValueType: CellValueType
): boolean => {
  return getRollupFunctionsByCellValueType(cellValueType).includes(expression);
};

const rollupExpressionSchema = z.enum(ROLLUP_FUNCTIONS);

const rollupValuesFieldId = 'values';

class RollupExpressionErrorCollector implements ANTLRErrorListener<Token> {
  private readonly errors: string[] = [];

  syntaxError<T extends Token>(
    _recognizer: Recognizer<T, ATNSimulator>,
    _offendingSymbol: T | undefined,
    _line: number,
    _charPositionInLine: number,
    msg: string,
    _e: RecognitionException | undefined
  ): void {
    this.errors.push(msg.split('expecting')[0].trim());
  }

  firstError(): string | undefined {
    return this.errors[0];
  }
}

export class RollupExpression extends ValueObject {
  private constructor(private readonly value: RollupFunction) {
    super();
  }

  static create(raw: unknown): Result<RollupExpression, DomainError> {
    const parsed = rollupExpressionSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid RollupExpression' }));
    return ok(new RollupExpression(parsed.data));
  }

  static default(): RollupExpression {
    return new RollupExpression(ROLLUP_FUNCTIONS[0]);
  }

  getParsedValueType(valuesType: {
    cellValueType: CellValueType;
    isMultipleCellValue: CellValueMultiplicity;
  }): Result<
    { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity },
    DomainError
  > {
    const parseResult = this.parseTree();
    if (parseResult.isErr()) return err(parseResult.error);

    const dependencies: Record<string, FormulaFieldReference> = {
      [rollupValuesFieldId]: {
        id: rollupValuesFieldId,
        cellValueType: this.toFormulaValueType(valuesType.cellValueType),
        isMultipleCellValue: valuesType.isMultipleCellValue.toBoolean(),
      },
    };

    const visitor = new FormulaTypeVisitor(dependencies);
    const valueResult = parseResult.value.accept(visitor);
    if (valueResult.isErr()) return err(valueResult.error);

    const typeResult = CellValueType.create(valueResult.value.type);
    if (typeResult.isErr()) return err(typeResult.error);
    const multiplicityResult = CellValueMultiplicity.create(valueResult.value.isMultiple ?? false);
    if (multiplicityResult.isErr()) return err(multiplicityResult.error);

    return ok({
      cellValueType: typeResult.value,
      isMultipleCellValue: multiplicityResult.value,
    });
  }

  equals(other: RollupExpression): boolean {
    return this.value === other.value;
  }

  toString(): RollupFunction {
    return this.value;
  }

  private parseTree(): Result<ExprContext, DomainError> {
    const inputStream = CharStreams.fromString(this.value);
    const lexer = new FormulaLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new Formula(tokenStream);
    parser.removeErrorListeners();
    const errorCollector = new RollupExpressionErrorCollector();
    parser.addErrorListener(errorCollector);
    const tree = parser.root();
    const error = errorCollector.firstError();
    if (error) return err(domainError.unexpected({ message: error }));
    return ok(tree);
  }

  private toFormulaValueType(valueType: CellValueType): FormulaCellValueType {
    return valueType.toString() as FormulaCellValueType;
  }
}
