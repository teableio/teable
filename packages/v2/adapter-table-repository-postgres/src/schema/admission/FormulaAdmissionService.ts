import { iterateFormulaSourceReferences } from '@teable/formula';
import {
  FormulaField,
  domainError,
  type DomainError,
  type Field,
  type IFormulaAdmissionService,
  type ISpecification,
  type ITableSpecVisitor,
  type Table,
  type TableAddFieldSpec,
  type TableAddFieldsSpec,
  type TableDuplicateFieldSpec,
  type TableUpdateFieldTypeSpec,
  type UpdateFormulaExpressionSpec,
  type UpdateFormulaTimeZoneSpec,
} from '@teable/v2-core';
import {
  FormulaSqlPgTranslator,
  FormulaCompileBudget,
  defaultFormulaCompileBudgetConfig,
  resolveFormulaCompileBudget,
  type FormulaCompileBudgetConfig,
  type IPgTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import { err, ok, safeTry, type Result } from 'neverthrow';
import { resolveStoredFormulaFieldSql } from '../../record/query-builder/computed/SameTableBatchQueryBuilder';
import { FieldValueChangeCollectorVisitor } from '../visitors/FieldValueChangeCollectorVisitor';

class AdmissionChanges extends FieldValueChangeCollectorVisitor {
  readonly roots = new Set<string>();
  readonly previous = new Map<string, FormulaField>();
  private add(field: Field) {
    if (field instanceof FormulaField) this.roots.add(field.id().toString());
  }
  override visitTableAddField(spec: TableAddFieldSpec) {
    this.add(spec.field());
    return ok(undefined);
  }
  override visitTableAddFields(spec: TableAddFieldsSpec) {
    spec.fields().forEach((field) => this.add(field));
    return ok(undefined);
  }
  override visitTableDuplicateField(spec: TableDuplicateFieldSpec) {
    this.add(spec.newField());
    return super.visitTableDuplicateField(spec);
  }
  override visitTableUpdateFieldType(spec: TableUpdateFieldTypeSpec) {
    const previous = spec.oldField();
    const next = spec.newField();
    if (previous instanceof FormulaField) this.previous.set(previous.id().toString(), previous);
    if (
      next instanceof FormulaField &&
      (!(previous instanceof FormulaField) ||
        !next.expression().equals(previous.expression()) ||
        (next.timeZone()?.toString() ?? 'utc') !== (previous.timeZone()?.toString() ?? 'utc'))
    )
      this.add(next);
    return super.visitTableUpdateFieldType(spec);
  }
  override visitUpdateFormulaExpression(spec: UpdateFormulaExpressionSpec) {
    if (!spec.previousExpression().equals(spec.nextExpression()))
      this.roots.add(spec.fieldId().toString());
    return super.visitUpdateFormulaExpression(spec);
  }
  override visitUpdateFormulaTimeZone(spec: UpdateFormulaTimeZoneSpec) {
    if (
      (spec.previousTimeZone()?.toString() ?? 'utc') !== (spec.nextTimeZone()?.toString() ?? 'utc')
    )
      this.roots.add(spec.fieldId().toString());
    return super.visitUpdateFormulaTimeZone(spec);
  }
}

/** Compiles schema only. Never executes SQL or reads customer record values. */
export class FormulaAdmissionService implements IFormulaAdmissionService {
  constructor(
    private readonly typeValidationStrategy: IPgTypeValidationStrategy,
    private readonly config: FormulaCompileBudgetConfig = defaultFormulaCompileBudgetConfig
  ) {}

  admitNew(table: Table): Result<void, DomainError> {
    return this.admitRoots(
      table,
      new Set(
        table
          .getFields()
          .filter((field) => field instanceof FormulaField)
          .map((field) => field.id().toString())
      )
    );
  }

  admitUpdate(
    table: Table,
    mutation: ISpecification<Table, ITableSpecVisitor>
  ): Result<void, DomainError> {
    const changes = new AdmissionChanges();
    const visited = mutation.accept(changes);
    if (visited.isErr()) return err(visited.error);
    for (const field of table.getFields()) {
      if (!(field instanceof FormulaField)) continue;
      const previous = changes.previous.get(field.id().toString());
      if (!previous) continue;
      const mode = resolveFormulaCompileBudget(previous, this.config);
      if (mode.isErr()) return err(mode.error);
      if (mode.value.mode === 'enforce') {
        const retained = field.enableFormulaSafety(1);
        if (retained.isErr()) return retained;
      }
    }
    const affected = new Set([
      ...changes.roots,
      ...changes.valueChangedFields().map((id) => id.toString()),
    ]);
    if (affected.size === 0) return ok(undefined);
    const dependents = new Map<string, string[]>();
    for (const field of table.getFields()) {
      const dependencies = new Set(field.dependencies().map((dependency) => dependency.toString()));
      if (field instanceof FormulaField) {
        // Old rows can lack dependency metadata; tokenize without invoking the recursive parser.
        for (const reference of iterateFormulaSourceReferences(field.expression().toString()))
          dependencies.add(reference);
      }
      for (const dependency of dependencies) {
        const list = dependents.get(dependency) ?? [];
        list.push(field.id().toString());
        dependents.set(dependency, list);
      }
    }
    const pending = [...affected];
    for (let index = 0; index < pending.length; index++) {
      for (const id of dependents.get(pending[index]) ?? []) {
        if (affected.has(id)) continue;
        affected.add(id);
        pending.push(id);
      }
    }
    return this.admitRoots(table, changes.roots, affected);
  }

  admitRoots(
    table: Table,
    newRoots: ReadonlySet<string>,
    affected = newRoots
  ): Result<void, DomainError> {
    const service = this;
    return safeTry(function* () {
      const fields = table.getFields();
      const roots: FormulaField[] = [];
      for (const field of fields) {
        if (!(field instanceof FormulaField)) continue;
        const id = field.id().toString();
        if (!affected.has(id)) continue;
        const inherited = yield* resolveFormulaCompileBudget(field, service.config);
        if (newRoots.has(id) || inherited.mode === 'enforce') roots.push(field);
      }
      if (roots.length === 0) return ok(undefined);
      for (const field of roots) {
        const id = field.id().toString();
        const budget = new FormulaCompileBudget({ ...service.config, mode: 'enforce' });
        const translator = new FormulaSqlPgTranslator({
          table,
          tableAlias: 'admission',
          timeZone: field.timeZone()?.toString(),
          typeValidationStrategy: service.typeValidationStrategy,
          budget,
          allowFieldNameFallback: false,
          resolveFieldSql: (dependency) =>
            resolveStoredFormulaFieldSql(
              dependency,
              'admission',
              budget,
              dependency.id().toString()
            ),
        });
        const compiled = translator
          .translateExpression(field.expression().toString())
          .andThen((expression) => translator.renderSql(expression));
        if (compiled.isErr())
          return err(
            domainError.validation({
              ...compiled.error,
              details: { ...compiled.error.details, fieldId: id },
            })
          );
      }
      // A failed sibling must not leave partially admitted ownership on the candidate.
      for (const field of roots)
        if (newRoots.has(field.id().toString())) yield* field.enableFormulaSafety(1);
      return ok(undefined);
    });
  }
}
