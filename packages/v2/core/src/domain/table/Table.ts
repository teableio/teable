import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { BaseId } from '../base/BaseId';
import { AggregateRoot } from '../shared/AggregateRoot';

import { topologicalSort } from '../shared/graph/topologicalSort';
import { DbTableName } from './DbTableName';
import { TableCreated } from './events/TableCreated';
import { TableDeleted } from './events/TableDeleted';
import { TableRenamed } from './events/TableRenamed';
import type { Field } from './fields/Field';
import type { FieldId } from './fields/FieldId';
import { FieldName } from './fields/FieldName';
import { FieldType } from './fields/FieldType';
import { validateForeignTablesForFields } from './fields/ForeignTableRelatedField';
import {
  LinkForeignTableReferenceVisitor,
  type LinkForeignTableReference,
} from './fields/visitors/LinkForeignTableReferenceVisitor';
import { resolveFormulaFields } from './resolveFormulaFields';
import { TableSpecBuilder } from './specs/TableSpecBuilder';
import type { ITableBuildProps } from './TableBuilder';
import { TableBuilder } from './TableBuilder';
import type { TableId } from './TableId';
import { TableMutator, type TableUpdateResult } from './TableMutator';
import type { TableName } from './TableName';
import type { View } from './views/View';
import { ViewColumnMeta } from './views/ViewColumnMeta';
import type { ViewId } from './views/ViewId';
import { CloneViewVisitor } from './views/visitors/CloneViewVisitor';

export class Table extends AggregateRoot<TableId> {
  private dbTableNameValue: DbTableName;

  private constructor(
    id: TableId,
    private readonly baseIdValue: BaseId,
    private readonly nameValue: TableName,
    private readonly fieldsValue: ReadonlyArray<Field>,
    private readonly viewsValue: ReadonlyArray<View>,
    private readonly primaryFieldIdValue: FieldId,
    options: { emitCreatedEvent: boolean }
  ) {
    super(id);

    if (options.emitCreatedEvent) {
      this.addDomainEvent(
        TableCreated.create({
          tableId: id,
          baseId: this.baseIdValue,
          tableName: nameValue,
          fieldIds: fieldsValue.map((f) => f.id()),
          viewIds: viewsValue.map((v) => v.id()),
        })
      );
    }
    this.dbTableNameValue = DbTableName.empty();
  }

  static builder(): TableBuilder {
    const factory = (props: ITableBuildProps): Table =>
      new Table(
        props.id,
        props.baseId,
        props.name,
        props.fields,
        props.views,
        props.primaryFieldId,
        {
          emitCreatedEvent: true,
        }
      );
    return TableBuilder.create(factory);
  }

  static specs(baseId: BaseId): TableSpecBuilder {
    return TableSpecBuilder.create(baseId);
  }

  specs(): TableSpecBuilder {
    return TableSpecBuilder.create(this.baseIdValue);
  }

  static rehydrate(props: ITableBuildProps): Result<Table, string> {
    if (props.fields.length === 0) return err('Table requires at least one Field');
    if (!props.fields.some((f) => f.id().equals(props.primaryFieldId)))
      return err('Primary Field must exist in Table fields');

    const table = new Table(
      props.id,
      props.baseId,
      props.name,
      props.fields,
      props.views,
      props.primaryFieldId,
      {
        emitCreatedEvent: false,
      }
    );

    if (props.dbTableName) {
      const setResult = table.setDbTableName(props.dbTableName);
      if (setResult.isErr()) return err(setResult.error);
    }

    return ok(table);
  }

  baseId(): BaseId {
    return this.baseIdValue;
  }

  name(): TableName {
    return this.nameValue;
  }

  dbTableName(): Result<DbTableName, string> {
    const valueResult = this.dbTableNameValue.value();
    if (valueResult.isErr()) return err(valueResult.error);
    return ok(this.dbTableNameValue);
  }

  setDbTableName(dbTableName: DbTableName): Result<void, string> {
    const nextValue = dbTableName.value();
    if (nextValue.isErr()) return err(nextValue.error);

    const currentValue = this.dbTableNameValue.value();
    if (currentValue.isOk()) {
      if (currentValue.value !== nextValue.value) return err('DbTableName already set');
      return ok(undefined);
    }

    this.dbTableNameValue = dbTableName;
    return ok(undefined);
  }

  fields(): ReadonlyArray<Field> {
    return [...this.fieldsValue];
  }

  generateFieldName(baseName: FieldName): Result<FieldName, string> {
    const existingNames = this.fieldsValue.map((field) => field.name());
    if (!existingNames.some((name) => name.equals(baseName))) {
      return ok(baseName);
    }

    const baseValue = baseName.toString();
    for (let index = 1; index <= 100; index += 1) {
      const suffix = index === 1 ? ' (linked)' : ` (linked ${index})`;
      const candidateResult = FieldName.create(`${baseValue}${suffix}`);
      if (candidateResult.isErr()) return err(candidateResult.error);
      const candidate = candidateResult.value;
      if (!existingNames.some((name) => name.equals(candidate))) {
        return ok(candidate);
      }
    }

    return err('Failed to generate unique FieldName');
  }

  primaryFieldId(): FieldId {
    return this.primaryFieldIdValue;
  }

  primaryField(): Result<Field, string> {
    const field = this.fieldsValue.find((f) => f.id().equals(this.primaryFieldIdValue));
    if (!field) return err('Primary field not found');
    return ok(field);
  }

  views(): ReadonlyArray<View> {
    return [...this.viewsValue];
  }

  fieldsByDependencies(): {
    ordered: ReadonlyArray<Field>;
    cycles: ReadonlyArray<ReadonlyArray<FieldId>>;
  } {
    const nodes = this.fieldsValue.map((field) => ({
      id: field.id(),
      dependencies: field.dependencies(),
    }));
    const result = topologicalSort(nodes);
    const fieldById = new Map(
      this.fieldsValue.map((field) => [field.id().toString(), field] as const)
    );
    return {
      ordered: result.order.map((id) => fieldById.get(id.toString())!),
      cycles: result.cycles,
    };
  }

  fieldIds(): ReadonlyArray<FieldId> {
    return this.fieldsValue.map((f) => f.id());
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    const visitor = new LinkForeignTableReferenceVisitor();
    return this.fieldsValue
      .reduce<Result<ReadonlyArray<LinkForeignTableReference>, string>>(
        (acc, field) =>
          acc.andThen((refs) => field.accept(visitor).map((next) => [...refs, ...next])),
        ok([])
      )
      .map((refs) => {
        const seen = new Set<string>();
        const unique: LinkForeignTableReference[] = [];
        for (const ref of refs) {
          const baseKey = ref.baseId ? ref.baseId.toString() : 'local';
          const key = `${baseKey}:${ref.foreignTableId.toString()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(ref);
        }
        return unique;
      });
  }

  viewIds(): ReadonlyArray<ViewId> {
    return this.viewsValue.map((v) => v.id());
  }

  markDeleted(): Result<void, string> {
    this.addDomainEvent(
      TableDeleted.create({
        tableId: this.id(),
        baseId: this.baseIdValue,
        tableName: this.nameValue,
        fieldIds: this.fieldIds(),
        viewIds: this.viewIds(),
      })
    );
    return ok(undefined);
  }

  update(build: (mutator: TableMutator) => TableMutator): Result<TableUpdateResult, string> {
    const mutator = build(TableMutator.create(this));
    return mutator.apply();
  }

  rename(nextName: TableName): Result<Table, string> {
    const cloned = this.cloneWithName(nextName);
    if (cloned.isErr()) return err(cloned.error);
    const nextTable = cloned.value;

    if (!this.nameValue.equals(nextName)) {
      nextTable.addDomainEvent(
        TableRenamed.create({
          tableId: nextTable.id(),
          baseId: nextTable.baseId(),
          previousName: this.nameValue,
          nextName,
        })
      );
    }

    return ok(nextTable);
  }

  addField(
    field: Field,
    options?: { foreignTables?: ReadonlyArray<Table> }
  ): Result<Table, string> {
    if (this.fieldsValue.some((existing) => existing.id().equals(field.id()))) {
      return err('Field already exists');
    }
    if (this.fieldsValue.some((existing) => existing.name().equals(field.name()))) {
      return err('Field names must be unique');
    }

    const validationResult = this.validateForeignTables([field], options?.foreignTables);
    if (validationResult.isErr()) return err(validationResult.error);

    const nextFields = [...this.fieldsValue, field];
    const nextViewsResult = this.cloneViewsWithField(nextFields, field);
    if (nextViewsResult.isErr()) return err(nextViewsResult.error);

    const props: ITableBuildProps = {
      id: this.id(),
      baseId: this.baseIdValue,
      name: this.nameValue,
      fields: nextFields,
      views: nextViewsResult.value,
      primaryFieldId: this.primaryFieldIdValue,
    };

    if (this.dbTableNameValue.isRehydrated()) {
      props.dbTableName = this.dbTableNameValue;
    }

    return Table.rehydrate(props).andThen((nextTable) => {
      if (!field.type().equals(FieldType.formula())) return ok(nextTable);
      return resolveFormulaFields(nextTable).map(() => nextTable);
    });
  }

  private validateForeignTables(
    fields: ReadonlyArray<Field>,
    foreignTables?: ReadonlyArray<Table>
  ): Result<void, string> {
    if (!foreignTables || foreignTables.length === 0) return ok(undefined);
    return validateForeignTablesForFields(fields, { hostTable: this, foreignTables });
  }

  private cloneWithName(nextName: TableName): Result<Table, string> {
    const props: ITableBuildProps = {
      id: this.id(),
      baseId: this.baseIdValue,
      name: nextName,
      fields: this.fields(),
      views: this.views(),
      primaryFieldId: this.primaryFieldIdValue,
    };

    if (this.dbTableNameValue.isRehydrated()) {
      props.dbTableName = this.dbTableNameValue;
    }

    return Table.rehydrate(props);
  }

  private cloneViewsWithField(
    fields: ReadonlyArray<Field>,
    newField: Field
  ): Result<ReadonlyArray<View>, string> {
    const defaultMetaByType = new Map<string, ViewColumnMeta>();
    const newFieldKey = newField.id().toString();

    const clones = this.viewsValue.map((view) => {
      const currentMetaResult = view.columnMeta();
      if (currentMetaResult.isErr()) return err(currentMetaResult.error);
      const currentMeta = currentMetaResult.value.toDto();

      const viewType = view.type().toString();
      let defaultMeta = defaultMetaByType.get(viewType);
      if (!defaultMeta) {
        const metaResult = ViewColumnMeta.forView({
          viewType: view.type(),
          fields,
          primaryFieldId: this.primaryFieldIdValue,
        });
        if (metaResult.isErr()) return err(metaResult.error);
        defaultMeta = metaResult.value;
        defaultMetaByType.set(viewType, defaultMeta);
      }

      const defaultEntry = defaultMeta.toDto()[newFieldKey];
      if (!defaultEntry) return err('Missing new field column meta');

      const currentEntries = Object.values(currentMeta);
      const maxOrder = currentEntries.length
        ? Math.max(...currentEntries.map((entry) => entry.order))
        : -1;

      const nextMeta = {
        ...currentMeta,
        [newFieldKey]: { ...defaultEntry, order: maxOrder + 1 },
      };

      const nextMetaResult = ViewColumnMeta.create(nextMeta);
      if (nextMetaResult.isErr()) return err(nextMetaResult.error);

      const cloneResult = view.accept(new CloneViewVisitor());
      if (cloneResult.isErr()) return err(cloneResult.error);

      const clone = cloneResult.value;
      const setResult = clone.setColumnMeta(nextMetaResult.value);
      if (setResult.isErr()) return err(setResult.error);

      return ok(clone);
    });

    return clones.reduce<Result<ReadonlyArray<View>, string>>(
      (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
      ok([])
    );
  }
}
