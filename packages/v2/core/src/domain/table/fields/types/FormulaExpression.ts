import {
  CharStreams,
  CommonTokenStream,
  FieldReferenceVisitor,
  FunctionCallCollectorVisitor,
  Formula,
  FormulaLexer,
  inspectFormulaAst,
  inspectFormulaStructure,
} from '@teable/formula';
import type {
  ANTLRErrorListener,
  ATNSimulator,
  ExprContext,
  Recognizer,
  RecognitionException,
  Token,
  FormulaStructureCheck,
} from '@teable/formula';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { CellValueType as FormulaCellValueType } from '../../../formula/CellValueType';
import type { FormulaFieldReference } from '../../../formula/FormulaFieldReference';
import { FormulaTypeVisitor } from '../../../formula/visitor';
import { domainError, type DomainError } from '../../../shared/DomainError';
import {
  ensureWithinTableDataSafetyLimit,
  tableDataSafetyLimitErrors,
} from '../../../shared/TableDataSafetyLimits';
import { ValueObject } from '../../../shared/ValueObject';
import { FieldId } from '../FieldId';
import type { FieldValueType } from '../visitors/FieldValueTypeVisitor';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';

const formulaExpressionSchema = z.string();

export type FormulaSourceBudget = Readonly<{
  astDepth: number;
  visitedNodes: number;
  policyVersion: number;
  referenceDepth?: number;
  check?: (
    metric: 'astDepth' | 'visitedNodes' | 'referenceDepth',
    attempted: number
  ) => { max: number } | undefined;
}>;

class FormulaSourceBudgetExceeded extends Error {
  constructor(readonly domainError: DomainError) {
    super(domainError.message);
  }
}

class FormulaErrorCollector implements ANTLRErrorListener<Token> {
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

export class FormulaExpression extends ValueObject {
  private constructor(
    private readonly value: string,
    private readonly sourceBudget?: FormulaSourceBudget
  ) {
    super();
  }

  static create(
    raw: unknown,
    sourceBudget?: FormulaSourceBudget
  ): Result<FormulaExpression, DomainError> {
    const parsed = formulaExpressionSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid FormulaExpression' }));
    if (
      sourceBudget &&
      [sourceBudget.astDepth, sourceBudget.visitedNodes, sourceBudget.policyVersion].some(
        (value) => !Number.isSafeInteger(value) || value < 1
      )
    ) {
      return err(domainError.validation({ message: 'Invalid formula source budget' }));
    }
    // Rehydration and retained definitions omit the budget. Admission supplies
    // it only for a new/effectively changed definition, never merely a rename.
    const expression = new FormulaExpression(
      parsed.data,
      sourceBudget ? Object.freeze({ ...sourceBudget }) : undefined
    );
    return expression
      .inspectStructure((check) => inspectFormulaStructure(parsed.data, check))
      .map(() => expression);
  }

  admissionBudget(): FormulaSourceBudget | undefined {
    return this.sourceBudget;
  }

  equals(other: FormulaExpression): boolean {
    return this.value === other.value;
  }

  getReferencedFieldIds(): Result<ReadonlyArray<FieldId>, DomainError> {
    const parseResult = this.parseTree();
    if (parseResult.isErr()) return err(parseResult.error);
    const visitor = new FieldReferenceVisitor();
    const rawRefs = Array.from(new Set(visitor.visit(parseResult.value))).map((ref) => String(ref));
    const invalidRefs: string[] = [];
    const ids: FieldId[] = [];

    for (const ref of rawRefs) {
      const idResult = FieldId.create(ref);
      if (idResult.isErr()) {
        invalidRefs.push(ref);
        continue;
      }
      ids.push(idResult.value);
    }

    if (invalidRefs.length > 0) {
      return err(
        domainError.validation({
          message: `Formula references not found: ${invalidRefs.join(
            ', '
          )}. Formulas must use field IDs (fldXXXXXXXXXXXXXXXX format), not field names.`,
        })
      );
    }

    return ok(ids);
  }

  hasLastModifiedTimeParams(): Result<boolean, DomainError> {
    const parseResult = this.parseTree();
    if (parseResult.isErr()) return err(parseResult.error);

    const calls = parseResult.value.accept(new FunctionCallCollectorVisitor());
    return ok(calls.some((call) => call.name === 'LAST_MODIFIED_TIME' && call.paramCount > 0));
  }

  getParsedValueType(
    fieldValueTypes: ReadonlyArray<{ id: FieldId; valueType: FieldValueType }>
  ): Result<
    { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity },
    DomainError
  > {
    const parseResult = this.parseTree();
    if (parseResult.isErr()) return err(parseResult.error);

    const dependencies: Record<string, FormulaFieldReference> = {};
    for (const entry of fieldValueTypes) {
      const typeKey = entry.id.toString();
      dependencies[typeKey] = {
        id: typeKey,
        cellValueType: this.toFormulaValueType(entry.valueType.cellValueType),
        isMultipleCellValue: entry.valueType.isMultipleCellValue.toBoolean(),
      };
    }

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

  toString(): string {
    return this.value;
  }

  private parseTree(): Result<ExprContext, DomainError> {
    const inputStream = CharStreams.fromString(this.value);
    const lexer = new FormulaLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new Formula(tokenStream);
    parser.removeErrorListeners();
    const errorCollector = new FormulaErrorCollector();
    parser.addErrorListener(errorCollector);
    const tree = parser.root();
    const error = errorCollector.firstError();
    if (error) return err(domainError.validation({ message: error }));
    return this.inspectStructure((check) => inspectFormulaAst(tree, check)).map(() => tree);
  }

  private inspectStructure(
    inspect: (check: FormulaStructureCheck) => void
  ): Result<void, DomainError> {
    const budget = this.sourceBudget;
    if (!budget) return ok(undefined);
    try {
      inspect((metric, attempted) => {
        const violation = budget.check?.(metric, attempted);
        if (budget.check && !violation) return;
        const result = ensureWithinTableDataSafetyLimit(
          metric === 'astDepth'
            ? tableDataSafetyLimitErrors.formulaCompileDepthMax
            : tableDataSafetyLimitErrors.formulaCompileNodesMax,
          attempted,
          violation?.max ?? budget[metric],
          { metric, policyVersion: budget.policyVersion }
        );
        // Stop the iterative inspector immediately; only this private signal
        // is converted to a DomainError, never unknown parser/program errors.
        if (result.isErr()) throw new FormulaSourceBudgetExceeded(result.error);
      });
      return ok(undefined);
    } catch (error) {
      if (error instanceof FormulaSourceBudgetExceeded) return err(error.domainError);
      throw error;
    }
  }

  private toFormulaValueType(valueType: CellValueType): FormulaCellValueType {
    return valueType.toString() as FormulaCellValueType;
  }
}
