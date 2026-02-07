import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../shared/DomainError';
import type { ISpecification } from '../shared/specification/ISpecification';
import { SpecBuilder, type SpecBuilderMode } from '../shared/specification/SpecBuilder';
import { Field } from './fields/Field';
import type { FieldId } from './fields/FieldId';
import type { SelectOption } from './fields/types/SelectOption';
import type { ITableSpecVisitor } from './specs/ITableSpecVisitor';
import { TableAddFieldSpec } from './specs/TableAddFieldSpec';
import { TableAddSelectOptionsSpec } from './specs/TableAddSelectOptionsSpec';
import { TableDuplicateFieldSpec } from './specs/TableDuplicateFieldSpec';
import { TableRemoveFieldSpec } from './specs/TableRemoveFieldSpec';
import { TableRenameSpec } from './specs/TableRenameSpec';
import { TableUpdateViewColumnMetaSpec } from './specs/TableUpdateViewColumnMetaSpec';
import { TableEventGeneratingSpecVisitor } from './specs/visitors/TableEventGeneratingSpecVisitor';
import type { Table } from './Table';
import type { TableName } from './TableName';

class TableMutateSpecBuilder extends SpecBuilder<Table, ITableSpecVisitor, TableMutateSpecBuilder> {
  private constructor(private currentTable: Table) {
    super('and');
  }

  static create(table: Table): TableMutateSpecBuilder {
    return new TableMutateSpecBuilder(table);
  }

  rename(tableName: TableName): TableMutateSpecBuilder {
    const previousName = this.currentTable.name();
    const nextTableResult = this.currentTable.rename(tableName);
    if (nextTableResult.isErr()) {
      this.recordError(nextTableResult.error);
      return this;
    }

    this.addSpec(TableRenameSpec.create(previousName, tableName));
    this.currentTable = nextTableResult.value;
    return this;
  }

  addField(
    field: Field,
    options?: { foreignTables?: ReadonlyArray<Table> }
  ): TableMutateSpecBuilder {
    const nextTableResult = this.currentTable.addField(field, options);
    if (nextTableResult.isErr()) {
      this.recordError(nextTableResult.error);
      return this;
    }

    // Use the field from nextTable which has dependencies resolved by Table.addField()
    // The original field passed in may have empty dependencies for formula fields
    const nextTable = nextTableResult.value;
    const resolvedFieldResult = nextTable.getField((f) => f.id().equals(field.id()));
    if (resolvedFieldResult.isErr()) {
      this.recordError(resolvedFieldResult.error);
      return this;
    }

    this.addSpec(TableAddFieldSpec.create(resolvedFieldResult.value));
    const viewSpecResult = TableUpdateViewColumnMetaSpec.fromTableWithFieldId(
      nextTableResult.value,
      field.id()
    );
    if (viewSpecResult.isErr()) {
      this.recordError(viewSpecResult.error);
      return this;
    }

    this.addSpec(viewSpecResult.value);
    this.currentTable = nextTableResult.value;
    return this;
  }

  addSelectOptions(fieldId: FieldId, options: ReadonlyArray<SelectOption>): TableMutateSpecBuilder {
    if (options.length === 0) {
      return this;
    }

    const nextTableResult = this.currentTable.addSelectOptions(fieldId, options);
    if (nextTableResult.isErr()) {
      this.recordError(nextTableResult.error);
      return this;
    }

    this.addSpec(TableAddSelectOptionsSpec.create(fieldId, options));
    this.currentTable = nextTableResult.value;
    return this;
  }

  removeField(fieldId: FieldId): TableMutateSpecBuilder {
    const fieldSpecResult = Field.specs().withFieldId(fieldId).build();
    if (fieldSpecResult.isErr()) {
      this.recordError(fieldSpecResult.error);
      return this;
    }
    const [field] = this.currentTable.getFields(fieldSpecResult.value);
    if (!field) {
      this.recordError('Field not found');
      return this;
    }

    const nextTableResult = this.currentTable.removeField(fieldId);
    if (nextTableResult.isErr()) {
      this.recordError(nextTableResult.error);
      return this;
    }

    this.addSpec(TableRemoveFieldSpec.create(field));
    const viewSpecResult = TableUpdateViewColumnMetaSpec.fromTableWithFieldId(
      nextTableResult.value,
      fieldId
    );
    if (viewSpecResult.isErr()) {
      this.recordError(viewSpecResult.error);
      return this;
    }

    this.addSpec(viewSpecResult.value);
    this.currentTable = nextTableResult.value;
    return this;
  }

  duplicateField(
    sourceField: Field,
    newField: Field,
    includeRecordValues: boolean
  ): TableMutateSpecBuilder {
    const nextTableResult = this.currentTable.addField(newField);
    if (nextTableResult.isErr()) {
      this.recordError(nextTableResult.error);
      return this;
    }

    // Use the field from nextTable which has dependencies resolved by Table.addField()
    const nextTable = nextTableResult.value;
    const resolvedFieldResult = nextTable.getField((f) => f.id().equals(newField.id()));
    if (resolvedFieldResult.isErr()) {
      this.recordError(resolvedFieldResult.error);
      return this;
    }

    this.addSpec(
      TableDuplicateFieldSpec.create(sourceField, resolvedFieldResult.value, includeRecordValues)
    );
    const viewSpecResult = TableUpdateViewColumnMetaSpec.fromTableWithFieldId(
      nextTableResult.value,
      newField.id()
    );
    if (viewSpecResult.isErr()) {
      this.recordError(viewSpecResult.error);
      return this;
    }

    this.addSpec(viewSpecResult.value);
    this.currentTable = nextTableResult.value;
    return this;
  }

  build(): Result<ISpecification<Table, ITableSpecVisitor>, DomainError> {
    return this.buildFrom(this.specs);
  }

  protected createChild(_mode: SpecBuilderMode): TableMutateSpecBuilder {
    return new TableMutateSpecBuilder(this.currentTable);
  }
}

export class TableUpdateResult {
  private constructor(
    readonly table: Table,
    readonly mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ) {}

  static create(
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): TableUpdateResult {
    return new TableUpdateResult(table, mutateSpec);
  }
}

export class TableMutator {
  private readonly builder: TableMutateSpecBuilder;
  private hasUpdates = false;

  private constructor(private readonly table: Table) {
    this.builder = TableMutateSpecBuilder.create(table);
  }

  static create(table: Table): TableMutator {
    return new TableMutator(table);
  }

  rename(tableName: TableName): TableMutator {
    this.builder.rename(tableName);
    this.hasUpdates = true;
    return this;
  }

  addField(field: Field, options?: { foreignTables?: ReadonlyArray<Table> }): TableMutator {
    this.builder.addField(field, options);
    this.hasUpdates = true;
    return this;
  }

  addSelectOptions(fieldId: FieldId, options: ReadonlyArray<SelectOption>): TableMutator {
    if (options.length === 0) {
      return this;
    }
    this.builder.addSelectOptions(fieldId, options);
    this.hasUpdates = true;
    return this;
  }

  removeField(fieldId: FieldId): TableMutator {
    this.builder.removeField(fieldId);
    this.hasUpdates = true;
    return this;
  }

  duplicateField(sourceField: Field, newField: Field, includeRecordValues: boolean): TableMutator {
    this.builder.duplicateField(sourceField, newField, includeRecordValues);
    this.hasUpdates = true;
    return this;
  }

  apply(): Result<TableUpdateResult, DomainError> {
    if (!this.hasUpdates) return err(domainError.validation({ message: 'Empty update' }));

    const specResult = this.builder.build();
    if (specResult.isErr()) return err(specResult.error);

    return specResult.value.mutate(this.table).andThen((updated) => {
      // Use visitor to generate events based on specs
      const eventVisitor = new TableEventGeneratingSpecVisitor(updated);
      const visitResult = specResult.value.accept(eventVisitor);
      if (visitResult.isErr()) return err(visitResult.error);

      // Record generated events to the table
      updated.recordDomainEvents(eventVisitor.getEvents());

      return ok(TableUpdateResult.create(updated, specResult.value));
    });
  }
}
