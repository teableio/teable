import {
  FormulaField,
  TableAddFieldSpec,
  type FieldOperationPluginContext,
  type FieldOperationKind,
  type IFieldOperationPlugin,
  type DomainError,
  type Table,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';
import type { FormulaAdmissionService } from './FormulaAdmissionService';

/** Plugin contexts are detached; authoritative admission/ownership lives in the repository. */
export class FormulaAdmissionFieldOperationPlugin implements IFieldOperationPlugin {
  readonly name = 'formula-admission';
  readonly enforce = 'pre' as const;
  constructor(private readonly admission: FormulaAdmissionService) {}
  supports(kind: FieldOperationKind) {
    return kind !== 'delete';
  }
  guard(context: FieldOperationPluginContext): Result<void, DomainError> {
    let candidate: Table = context.table;
    if (context.kind === 'update') {
      for (const spec of context.payload.updateSpecs) {
        const changed = spec.mutate(candidate);
        if (changed.isErr()) return err(changed.error);
        candidate = changed.value;
      }
      for (const spec of context.payload.updateSpecs) {
        const admitted = this.admission.admitUpdate(candidate, spec);
        if (admitted.isErr()) return admitted;
      }
    } else if (
      context.kind === 'create' &&
      context.payload.candidateField instanceof FormulaField
    ) {
      const fieldId = context.payload.candidateField.id();
      if (candidate.getFields().some((field) => field.id().equals(fieldId))) {
        return this.admission.admitRoots(candidate, new Set([fieldId.toString()]));
      }
      const spec = TableAddFieldSpec.create(context.payload.candidateField);
      const changed = spec.mutate(candidate);
      if (changed.isErr()) return err(changed.error);
      return this.admission.admitUpdate(changed.value, spec);
    } else if (context.kind === 'duplicate') {
      return this.admission.admitRoots(
        candidate,
        new Set([context.payload.sourceField.id().toString()])
      );
    }
    return ok(undefined);
  }
  beforePersist(context: FieldOperationPluginContext): Result<void, DomainError> {
    if (context.kind === 'update') {
      for (const spec of context.payload.updateSpecs) {
        const result = this.admission.admitUpdate(context.table, spec);
        if (result.isErr()) return result;
      }
    } else if (context.kind === 'create' && context.result) {
      return this.admission.admitRoots(
        context.table,
        new Set([context.result.createdField.id().toString()])
      );
    } else if (context.kind === 'duplicate' && context.result) {
      return this.admission.admitRoots(
        context.table,
        new Set([context.result.duplicatedField.id().toString()])
      );
    }
    return ok(undefined);
  }
}
