import type {
  ANTLRErrorListener,
  ATNSimulator,
  ExprContext,
  Recognizer,
  RecognitionException,
  Token,
} from '@teable/formula';
import {
  CharStreams,
  CommonTokenStream,
  FieldReferenceVisitor,
  FunctionCallCollectorVisitor,
  Formula,
  FormulaLexer,
} from '@teable/formula';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { CellValueType as FormulaCellValueType } from '../../../formula/CellValueType';
import type { FormulaFieldReference } from '../../../formula/FormulaFieldReference';
import { FormulaTypeVisitor } from '../../../formula/visitor';
import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import { FieldId } from '../FieldId';
import type { FieldValueType } from '../visitors/FieldValueTypeVisitor';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';

const formulaExpressionSchema = z.string();

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
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<FormulaExpression, DomainError> {
    const parsed = formulaExpressionSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid FormulaExpression' }));
    return ok(new FormulaExpression(parsed.data));
  }

  equals(other: FormulaExpression): boolean {
    return this.value === other.value;
  }

  getReferencedFieldIds(): Result<ReadonlyArray<FieldId>, DomainError> {
    const parseResult = this.parseTree();
    if (parseResult.isErr()) {
      return err(
        domainError.validation({
          message: `Formula expression ${this.value} parse error: ${parseResult.error}`,
        })
      );
    }
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
    if (parseResult.isErr()) {
      return err(
        domainError.validation({
          message: `Formula expression ${this.value} parse error: ${parseResult.error}`,
        })
      );
    }

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
    return ok(tree);
  }

  private toFormulaValueType(valueType: CellValueType): FormulaCellValueType {
    return valueType.toString() as FormulaCellValueType;
  }
}
