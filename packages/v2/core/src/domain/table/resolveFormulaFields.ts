import { defaultFormulaSourceBudgetLimits, iterateFormulaSourceReferences } from '@teable/formula';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../shared/DomainError';
import { domainError } from '../shared/DomainError';
import {
  ensureWithinTableDataSafetyLimit,
  tableDataSafetyLimitErrors,
} from '../shared/TableDataSafetyLimits';
import { FieldId } from './fields/FieldId';
import { FieldType } from './fields/FieldType';
import { FieldHasError } from './fields/types/FieldHasError';
import { FormulaExpression, type FormulaSourceBudget } from './fields/types/FormulaExpression';
import type { FormulaField } from './fields/types/FormulaField';
import { FormulaField as FormulaFieldType } from './fields/types/FormulaField';
import {
  FieldValueTypeVisitor,
  type FieldValueType,
} from './fields/visitors/FieldValueTypeVisitor';
import type { Table } from './Table';

const withFormulaFieldContext = (field: FormulaField, error: DomainError): DomainError => {
  const message = `Formula field "${field.name().toString()}" (${field
    .id()
    .toString()}) invalid options: ${error.message}`;
  return {
    ...error,
    message,
    toString: () => message,
  };
};

export const resolveFormulaFields = (
  table: Table,
  options?: {
    ignoreMissingReferenceOnExisting?: boolean;
    strictFieldId?: FieldId;
    sourceBudget?: FormulaSourceBudget;
  }
): Result<void, DomainError> => {
  const fields = table.getFields();
  const fieldById = new Map(fields.map((field) => [field.id().toString(), field] as const));
  const dependenciesByFieldId = new Map<string, ReadonlyArray<FieldId>>();
  // A new root can reference legacy sources: guard that closure before any AST parser runs.
  // Use lexer tokens here so a legacy source's own parser cannot precede admission.
  const admittedExpressions = new Map<string, FormulaExpression>();
  for (const root of fields) {
    if (!(root instanceof FormulaFieldType)) continue;
    const budget = options?.sourceBudget ?? root.expression().admissionBudget();
    if (!budget) continue;
    const pending: Array<{ field: FormulaField; depth: number; exit?: boolean }> = [
      { field: root, depth: 0 },
    ];
    const visitedDepth = new Map<string, number>();
    const active = new Set<string>();
    while (pending.length) {
      const frame = pending.pop()!;
      const current = frame.field;
      const id = current.id().toString();
      if (frame.exit) {
        active.delete(id);
        continue;
      }
      if (active.has(id))
        return err(domainError.invariant({ message: 'Formula field dependency cycle detected' }));
      const violation = budget.check?.('referenceDepth', frame.depth);
      if (!budget.check || violation) {
        const limit = ensureWithinTableDataSafetyLimit(
          tableDataSafetyLimitErrors.formulaReferenceDepthMax,
          frame.depth,
          violation?.max ??
            budget.referenceDepth ??
            defaultFormulaSourceBudgetLimits.referenceDepth,
          { metric: 'referenceDepth', policyVersion: budget.policyVersion }
        );
        if (limit.isErr()) return err(limit.error);
      }
      if ((visitedDepth.get(id) ?? -1) >= frame.depth) continue;
      visitedDepth.set(id, frame.depth);
      active.add(id);
      pending.push({ ...frame, exit: true });
      const guarded = FormulaExpression.create(current.expression().toString(), budget);
      if (guarded.isErr()) return err(guarded.error);
      admittedExpressions.set(id, guarded.value);
      for (const reference of iterateFormulaSourceReferences(current.expression().toString())) {
        const dependency = fieldById.get(reference);
        if (dependency instanceof FormulaFieldType)
          pending.push({ field: dependency, depth: frame.depth + 1 });
      }
    }
  }

  for (const field of fields) {
    if (!field.type().equals(FieldType.formula())) continue;
    const formulaField = field as FormulaField;
    const referenceResult = (
      admittedExpressions.get(field.id().toString()) ?? formulaField.expression()
    ).getReferencedFieldIds();
    if (referenceResult.isErr()) {
      return err(referenceResult.error);
    }

    const uniqueRefs = Array.from(new Set(referenceResult.value.map((id) => id.toString())));
    const dependencies: FieldId[] = [];
    const missingRefs: string[] = [];

    for (const ref of uniqueRefs) {
      if (!fieldById.has(ref)) {
        missingRefs.push(ref);
        continue;
      }
      const fieldIdResult = FieldId.create(ref);
      if (fieldIdResult.isErr()) return err(fieldIdResult.error);
      dependencies.push(fieldIdResult.value);
    }

    const isStrictField = options?.strictFieldId ? field.id().equals(options.strictFieldId) : false;
    if (missingRefs.length > 0) {
      if (options?.ignoreMissingReferenceOnExisting && !isStrictField) {
        formulaField.setHasError(FieldHasError.error());
        const dependencyResult = formulaField.setDependencies(dependencies);
        if (dependencyResult.isErr()) return err(dependencyResult.error);
        dependenciesByFieldId.set(field.id().toString(), dependencies);
        continue;
      }

      return err(
        domainError.notFound({
          message: `Formula field references not found: ${missingRefs.join(
            ', '
          )}. These field IDs do not exist in the table.`,
        })
      );
    }

    formulaField.setHasError(FieldHasError.ok());
    const dependencyResult = formulaField.setDependencies(dependencies);
    if (dependencyResult.isErr()) return err(dependencyResult.error);
    dependenciesByFieldId.set(field.id().toString(), dependencies);
  }

  const dependentsByFieldId = new Map<string, FieldId[]>();
  for (const [fieldId, dependencies] of dependenciesByFieldId) {
    const dependentIdResult = FieldId.create(fieldId);
    if (dependentIdResult.isErr()) return err(dependentIdResult.error);
    const dependentId = dependentIdResult.value;
    for (const dependency of dependencies) {
      const list = dependentsByFieldId.get(dependency.toString()) ?? [];
      list.push(dependentId);
      dependentsByFieldId.set(dependency.toString(), list);
    }
  }

  for (const field of fields) {
    const dependents = dependentsByFieldId.get(field.id().toString()) ?? [];
    const setResult = field.setDependents(dependents);
    if (setResult.isErr()) return err(setResult.error);
  }

  const dependencyOrder = table.fieldsByDependencies();
  if (dependencyOrder.cycles.length > 0) {
    const cycleMessage = dependencyOrder.cycles
      .map((cycle) => cycle.map((id) => id.toString()).join(' -> '))
      .join('; ');
    return err(
      domainError.invariant({
        message: `Formula field dependency cycle detected: ${cycleMessage}`,
      })
    );
  }

  const valueTypeVisitor = new FieldValueTypeVisitor();
  const valueTypes: Array<{ id: FieldId; valueType: FieldValueType }> = [];

  for (const field of fields) {
    if (field.type().equals(FieldType.formula())) continue;
    const typeResult = field.accept(valueTypeVisitor);
    if (typeResult.isErr()) {
      if (
        field.type().equals(FieldType.rollup()) ||
        field.type().equals(FieldType.conditionalRollup())
      ) {
        continue;
      }
      return err(typeResult.error);
    }
    valueTypes.push({ id: field.id(), valueType: typeResult.value });
  }

  for (const field of dependencyOrder.ordered) {
    if (!field.type().equals(FieldType.formula())) continue;
    const formulaField = field as FormulaField;
    if (formulaField.hasError().isError()) {
      continue;
    }
    const typeResult = (
      admittedExpressions.get(field.id().toString()) ?? formulaField.expression()
    ).getParsedValueType(valueTypes);
    if (typeResult.isErr()) {
      const parseError = typeResult.error;
      if (
        parseError.code === tableDataSafetyLimitErrors.formulaCompileDepthMax.code ||
        parseError.code === tableDataSafetyLimitErrors.formulaCompileNodesMax.code
      )
        return err(parseError);
      const parseMessage = `Parse formula expression ${formulaField.expression().toString()} error: ${parseError}`;
      return err(
        // Preserve original domain tags (validation/invariant/etc.) so HTTP status mapping stays correct.
        {
          ...parseError,
          message: parseMessage,
          toString: () => parseMessage,
        }
      );
    }

    const { cellValueType, isMultipleCellValue } = typeResult.value;

    const currentCellValueType = formulaField.cellValueType();
    const currentMultiplicity = formulaField.isMultipleCellValue();
    if (currentCellValueType.isOk() && currentMultiplicity.isOk()) {
      valueTypes.push({ id: field.id(), valueType: typeResult.value });
      continue;
    }

    const setTypeResult = formulaField.setResultType(cellValueType, isMultipleCellValue);
    if (setTypeResult.isErr())
      return err(withFormulaFieldContext(formulaField, setTypeResult.error));

    if (!formulaField.formatting()) {
      const defaultFormatting = FormulaFieldType.defaultFormatting(cellValueType);
      if (defaultFormatting) {
        const formattingResult = formulaField.setFormatting(defaultFormatting);
        if (formattingResult.isErr()) return err(formattingResult.error);
      }
    }

    valueTypes.push({ id: field.id(), valueType: typeResult.value });
  }

  return ok(undefined);
};
