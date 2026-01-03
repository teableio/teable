import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import type { BaseId } from '../base/BaseId';
import { AggregateRoot } from '../shared/AggregateRoot';
import { domainError, type DomainError } from '../shared/DomainError';
import { topologicalSort } from '../shared/graph/topologicalSort';
import type { ISpecification } from '../shared/specification/ISpecification';
import type { ISpecVisitor } from '../shared/specification/ISpecVisitor';
import { NotSpec } from '../shared/specification/NotSpec';

import { DbTableName } from './DbTableName';
import { FieldCreated } from './events/FieldCreated';
import { FieldDeleted } from './events/FieldDeleted';
import { TableCreated } from './events/TableCreated';
import { TableDeleted } from './events/TableDeleted';
import { TableRenamed } from './events/TableRenamed';
import { ViewColumnMetaUpdated } from './events/ViewColumnMetaUpdated';
import type { Field } from './fields/Field';
import type { FieldId } from './fields/FieldId';
import { FieldName } from './fields/FieldName';
import { FieldType } from './fields/FieldType';
import { validateForeignTablesForFields } from './fields/ForeignTableRelatedField';
import { FieldIsComputedSpec } from './fields/specs/FieldIsComputedSpec';
import { FieldCellValueSchemaVisitor } from './fields/visitors/FieldCellValueSchemaVisitor';
import { FieldDefaultValueVisitor } from './fields/visitors/FieldDefaultValueVisitor';
import {
  LinkForeignTableReferenceVisitor,
  type LinkForeignTableReference,
} from './fields/visitors/LinkForeignTableReferenceVisitor';
import { RecordId } from './records/RecordId';
import { RecordMutationSpecBuilder } from './records/RecordMutationSpecBuilder';
import { TableRecord } from './records/TableRecord';
import { TableRecordFields } from './records/TableRecordFields';
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

  static rehydrate(props: ITableBuildProps): Result<Table, DomainError> {
    if (props.fields.length === 0)
      return err(domainError.unexpected({ message: 'Table requires at least one Field' }));
    if (!props.fields.some((f) => f.id().equals(props.primaryFieldId)))
      return err(domainError.validation({ message: 'Primary Field must exist in Table fields' }));

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

  dbTableName(): Result<DbTableName, DomainError> {
    const valueResult = this.dbTableNameValue.value();
    if (valueResult.isErr()) return err(valueResult.error);
    return ok(this.dbTableNameValue);
  }

  setDbTableName(dbTableName: DbTableName): Result<void, DomainError> {
    const nextValue = dbTableName.value();
    if (nextValue.isErr()) return err(nextValue.error);

    const currentValue = this.dbTableNameValue.value();
    if (currentValue.isOk()) {
      if (currentValue.value !== nextValue.value)
        return err(domainError.invariant({ message: 'DbTableName already set' }));
      return ok(undefined);
    }

    this.dbTableNameValue = dbTableName;
    return ok(undefined);
  }

  getField<T extends Field>(predicate: (field: Field) => field is T): Result<T, DomainError>;
  getField(predicate: (field: Field) => boolean): Result<Field, DomainError>;
  getField(spec: ISpecification<Field, ISpecVisitor>): Result<Field, DomainError>;
  getField<T extends Field>(
    predicateOrSpec:
      | ((field: Field) => field is T)
      | ((field: Field) => boolean)
      | ISpecification<Field, ISpecVisitor>
  ): Result<T | Field, DomainError> {
    const predicate =
      typeof predicateOrSpec === 'function'
        ? predicateOrSpec
        : (field: Field) => predicateOrSpec.isSatisfiedBy(field);
    const field = this.fieldsValue.find(predicate);
    if (!field) return err(domainError.notFound({ message: 'Field not found' }));
    return ok(field);
  }

  getFields<T extends Field>(predicate: (field: Field) => field is T): ReadonlyArray<T>;
  getFields(predicate: (field: Field) => boolean): ReadonlyArray<Field>;
  getFields(spec: ISpecification<Field, ISpecVisitor>): ReadonlyArray<Field>;
  getFields(): ReadonlyArray<Field>;
  getFields<T extends Field>(
    predicateOrSpec?:
      | ((field: Field) => field is T)
      | ((field: Field) => boolean)
      | ISpecification<Field, ISpecVisitor>
  ): ReadonlyArray<T | Field> {
    if (!predicateOrSpec) return [...this.fieldsValue];
    const predicate =
      typeof predicateOrSpec === 'function'
        ? predicateOrSpec
        : (field: Field) => predicateOrSpec.isSatisfiedBy(field);
    return this.fieldsValue.filter(predicate);
  }

  generateFieldName(baseName: FieldName): Result<FieldName, DomainError> {
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

    return err(domainError.conflict({ message: 'Failed to generate unique FieldName' }));
  }

  primaryFieldId(): FieldId {
    return this.primaryFieldIdValue;
  }

  primaryField(): Result<Field, DomainError> {
    const field = this.fieldsValue.find((f) => f.id().equals(this.primaryFieldIdValue));
    if (!field) return err(domainError.notFound({ message: 'Primary field not found' }));
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

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const visitor = new LinkForeignTableReferenceVisitor();
    return this.fieldsValue
      .reduce<Result<ReadonlyArray<LinkForeignTableReference>, DomainError>>(
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

  /**
   * Get editable (non-computed) fields in this table.
   * Uses NotSpec(FieldIsComputedSpec) internally.
   */
  getEditableFields(): ReadonlyArray<Field> {
    const notComputedSpec = new NotSpec(FieldIsComputedSpec.create());
    return this.getFields(notComputedSpec);
  }

  /**
   * Create a Zod schema for record input validation.
   * Only includes editable (non-computed) fields.
   *
   * @returns Result containing the Zod object schema
   *
   * @example
   * ```typescript
   * const schemaResult = table.createRecordInputSchema();
   * if (schemaResult.isOk()) {
   *   const validated = schemaResult.value.safeParse({ fieldId: 'value' });
   * }
   * ```
   */
  createRecordInputSchema(): Result<z.ZodObject<Record<string, z.ZodTypeAny>>, DomainError> {
    const editableFields = this.getEditableFields();
    const schemaShape: Record<string, z.ZodTypeAny> = {};
    const visitor = FieldCellValueSchemaVisitor.create();

    for (const field of editableFields) {
      const schemaResult = field.accept(visitor);
      if (schemaResult.isErr()) {
        return err(schemaResult.error);
      }
      schemaShape[field.id().toString()] = schemaResult.value;
    }

    return ok(z.object(schemaShape));
  }

  /**
   * Create a new record for this table with the given field values.
   *
   * This method:
   * 1. Generates a new record ID
   * 2. Validates and applies field values using the mutation spec builder
   * 3. Returns the fully constructed record
   *
   * @param fieldValues - Map of field IDs to raw values
   * @returns Result containing the new record or validation error
   *
   * @example
   * ```typescript
   * const recordResult = table.createRecord(new Map([
   *   ['fld123', 'John Doe'],
   *   ['fld456', 30],
   * ]));
   * ```
   */
  createRecord(fieldValues: ReadonlyMap<string, unknown>): Result<TableRecord, DomainError> {
    return this.buildRecord(fieldValues);
  }

  /**
   * Create multiple records for this table with the given field values.
   *
   * This method:
   * 1. Iterates through all field values arrays
   * 2. Creates each record using the same logic as createRecord
   * 3. Returns all created records or the first validation error
   *
   * @param recordsFieldValues - Array of field value maps, one per record
   * @returns Result containing array of new records or validation error
   *
   * @example
   * ```typescript
   * const recordsResult = table.createRecords([
   *   new Map([['fld123', 'John'], ['fld456', 30]]),
   *   new Map([['fld123', 'Jane'], ['fld456', 25]]),
   * ]);
   * ```
   */
  createRecords(
    recordsFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>>
  ): Result<ReadonlyArray<TableRecord>, DomainError> {
    const table = this;
    return safeTry<ReadonlyArray<TableRecord>, DomainError>(function* () {
      const records: TableRecord[] = [];
      for (const fieldValues of recordsFieldValues) {
        const record = yield* table.buildRecord(fieldValues);
        records.push(record);
      }
      return ok(records);
    });
  }

  /**
   * Create records in a streaming/batched fashion using a Generator.
   *
   * This method is memory-friendly for large record sets:
   * - Lazily processes input records
   * - Yields batches of created records
   * - Only keeps batchSize records in memory at a time
   * - Stops immediately on first validation error
   *
   * @param recordsFieldValues - Iterable of field value maps (can be lazy/streaming)
   * @param options - Optional configuration
   * @param options.batchSize - Number of records per batch (default: 500)
   * @returns Generator yielding Result batches of created records
   *
   * @example
   * ```typescript
   * // Process 100k records with bounded memory
   * function* generateRecords() {
   *   for (let i = 0; i < 100000; i++) {
   *     yield new Map([['fld123', `Record ${i}`]]);
   *   }
   * }
   *
   * for (const batchResult of table.createRecordsStream(generateRecords(), { batchSize: 500 })) {
   *   if (batchResult.isErr()) {
   *     console.error(batchResult.error);
   *     break;
   *   }
   *   // Process batch of 500 records
   *   await repository.insertMany(batchResult.value);
   * }
   * ```
   */
  *createRecordsStream(
    recordsFieldValues: Iterable<ReadonlyMap<string, unknown>>,
    options?: { batchSize?: number }
  ): Generator<Result<ReadonlyArray<TableRecord>, DomainError>> {
    const batchSize = options?.batchSize ?? 500;
    let batch: TableRecord[] = [];

    for (const fieldValues of recordsFieldValues) {
      const recordResult = this.buildRecord(fieldValues);
      if (recordResult.isErr()) {
        yield err(recordResult.error);
        return;
      }
      batch.push(recordResult.value);

      if (batch.length >= batchSize) {
        yield ok(batch);
        batch = []; // Reset for next batch, allows GC to collect previous batch
      }
    }

    // Yield remaining records if any
    if (batch.length > 0) {
      yield ok(batch);
    }
  }

  /**
   * Async version of createRecordsStream for AsyncIterable sources.
   * Useful for streaming from URLs or large files without loading into memory.
   *
   * @param recordsFieldValues - An async iterable yielding Maps of field ID -> value
   * @param options.batchSize - Number of records per batch (default: 500)
   * @returns An async generator yielding Results containing batches of TableRecords
   */
  async *createRecordsStreamAsync(
    recordsFieldValues: AsyncIterable<ReadonlyMap<string, unknown>>,
    options?: { batchSize?: number }
  ): AsyncGenerator<Result<ReadonlyArray<TableRecord>, DomainError>> {
    const batchSize = options?.batchSize ?? 500;
    let batch: TableRecord[] = [];

    for await (const fieldValues of recordsFieldValues) {
      const recordResult = this.buildRecord(fieldValues);
      if (recordResult.isErr()) {
        yield err(recordResult.error);
        return;
      }
      batch.push(recordResult.value);

      if (batch.length >= batchSize) {
        yield ok(batch);
        batch = []; // Reset for next batch, allows GC to collect previous batch
      }
    }

    // Yield remaining records if any
    if (batch.length > 0) {
      yield ok(batch);
    }
  }

  /**
   * Internal method to build a single record with the given field values.
   * Used by both createRecord, createRecords, and createRecordsStream.
   */
  private buildRecord(fieldValues: ReadonlyMap<string, unknown>): Result<TableRecord, DomainError> {
    const table = this;
    return safeTry<TableRecord, DomainError>(function* () {
      // 1. Generate a new record ID
      const recordId = yield* RecordId.generate();

      // 2. Build mutation specs from field values with default value support
      const builder = RecordMutationSpecBuilder.create();
      const fields = table.getEditableFields();
      const defaultValueVisitor = FieldDefaultValueVisitor.create();

      for (const field of fields) {
        const fieldIdStr = field.id().toString();
        const providedValue = fieldValues.get(fieldIdStr);

        // If value was explicitly provided (even if null), use it
        if (fieldValues.has(fieldIdStr) && providedValue !== undefined && providedValue !== null) {
          builder.set(field, providedValue);
        } else {
          // Otherwise, try to get the default value
          const defaultValueResult = field.accept(defaultValueVisitor);
          if (defaultValueResult.isOk()) {
            const defaultValue = defaultValueResult.value;
            if (defaultValue !== undefined) {
              builder.set(field, defaultValue);
            }
          }
        }
      }

      // 3. Check for validation errors before proceeding
      if (builder.hasErrors()) {
        return err(builder.getErrors()[0]!);
      }

      // 4. Create an empty record
      const emptyFields = yield* TableRecordFields.create([]);
      const emptyRecord = yield* TableRecord.create({
        id: recordId,
        tableId: table.id(),
        fieldValues: emptyFields.entries(),
      });

      // 5. Apply mutation spec if there are any values to set
      if (builder.hasSpecs()) {
        return ok(yield* builder.buildAndMutate(emptyRecord));
      }
      return ok(emptyRecord);
    });
  }

  viewIds(): ReadonlyArray<ViewId> {
    return this.viewsValue.map((v) => v.id());
  }

  markDeleted(): Result<void, DomainError> {
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

  update(build: (mutator: TableMutator) => TableMutator): Result<TableUpdateResult, DomainError> {
    const mutator = build(TableMutator.create(this));
    return mutator.apply();
  }

  rename(nextName: TableName): Result<Table, DomainError> {
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
  ): Result<Table, DomainError> {
    if (this.fieldsValue.some((existing) => existing.id().equals(field.id()))) {
      return err(domainError.conflict({ message: 'Field already exists' }));
    }
    if (this.fieldsValue.some((existing) => existing.name().equals(field.name()))) {
      return err(domainError.conflict({ message: 'Field names must be unique' }));
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
      const resolved = field.type().equals(FieldType.formula())
        ? resolveFormulaFields(nextTable)
        : ok(undefined);
      if (resolved.isErr()) return err(resolved.error);
      nextTable.addDomainEvent(
        FieldCreated.create({
          tableId: nextTable.id(),
          baseId: nextTable.baseId(),
          fieldId: field.id(),
        })
      );
      for (const view of nextTable.views()) {
        nextTable.addDomainEvent(
          ViewColumnMetaUpdated.create({
            tableId: nextTable.id(),
            baseId: nextTable.baseId(),
            viewId: view.id(),
            fieldId: field.id(),
          })
        );
      }
      return ok(nextTable);
    });
  }

  removeField(fieldId: FieldId): Result<Table, DomainError> {
    if (this.primaryFieldIdValue.equals(fieldId)) {
      return err(domainError.validation({ message: 'Cannot delete primary field' }));
    }

    const targetField = this.fieldsValue.find((field) => field.id().equals(fieldId));
    if (!targetField) return err(domainError.notFound({ message: 'Field not found' }));

    const nextFields = this.fieldsValue.filter((field) => !field.id().equals(fieldId));
    if (nextFields.length === 0)
      return err(domainError.unexpected({ message: 'Table requires at least one Field' }));

    const nextViewsResult = this.cloneViewsWithoutField(nextFields, fieldId);
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

    return Table.rehydrate(props).map((nextTable) => {
      nextTable.addDomainEvent(
        FieldDeleted.create({
          tableId: nextTable.id(),
          baseId: nextTable.baseId(),
          fieldId,
        })
      );
      for (const view of nextTable.views()) {
        nextTable.addDomainEvent(
          ViewColumnMetaUpdated.create({
            tableId: nextTable.id(),
            baseId: nextTable.baseId(),
            viewId: view.id(),
            fieldId,
          })
        );
      }
      return nextTable;
    });
  }

  private validateForeignTables(
    fields: ReadonlyArray<Field>,
    foreignTables?: ReadonlyArray<Table>
  ): Result<void, DomainError> {
    if (!foreignTables || foreignTables.length === 0) return ok(undefined);
    return validateForeignTablesForFields(fields, { hostTable: this, foreignTables });
  }

  private cloneWithName(nextName: TableName): Result<Table, DomainError> {
    const props: ITableBuildProps = {
      id: this.id(),
      baseId: this.baseIdValue,
      name: nextName,
      fields: this.getFields(),
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
  ): Result<ReadonlyArray<View>, DomainError> {
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
      if (!defaultEntry)
        return err(domainError.validation({ message: 'Missing new field column meta' }));

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

    return clones.reduce<Result<ReadonlyArray<View>, DomainError>>(
      (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
      ok([])
    );
  }

  private cloneViewsWithoutField(
    fields: ReadonlyArray<Field>,
    removedFieldId: FieldId
  ): Result<ReadonlyArray<View>, DomainError> {
    const removedKey = removedFieldId.toString();
    const clones = this.viewsValue.map((view) => {
      const currentMetaResult = view.columnMeta();
      if (currentMetaResult.isErr()) return err(currentMetaResult.error);
      const currentMeta = currentMetaResult.value.toDto();
      if (currentMeta[removedKey]) {
        delete currentMeta[removedKey];
      }

      const nextMetaResult = ViewColumnMeta.create(currentMeta);
      if (nextMetaResult.isErr()) return err(nextMetaResult.error);

      const cloneResult = view.accept(new CloneViewVisitor());
      if (cloneResult.isErr()) return err(cloneResult.error);

      const clone = cloneResult.value;
      const setResult = clone.setColumnMeta(nextMetaResult.value);
      if (setResult.isErr()) return err(setResult.error);

      return ok(clone);
    });

    return clones.reduce<Result<ReadonlyArray<View>, DomainError>>(
      (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
      ok([])
    );
  }
}
