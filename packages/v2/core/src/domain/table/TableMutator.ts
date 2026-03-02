import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../shared/DomainError';
import type { ISpecification } from '../shared/specification/ISpecification';
import { SpecBuilder, type SpecBuilderMode } from '../shared/specification/SpecBuilder';
import { Field } from './fields/Field';
import type { FieldId } from './fields/FieldId';
import type { FieldName } from './fields/FieldName';
import {
  isForeignTableRelatedField,
  validateForeignTablesForFields,
} from './fields/ForeignTableRelatedField';
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
import { ViewColumnMeta } from './views/ViewColumnMeta';
import type { ViewId } from './views/ViewId';

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
    options?: {
      foreignTables?: ReadonlyArray<Table>;
      viewOrder?: {
        viewId: ViewId;
        order: number;
      };
    }
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
    const viewSpecResult = (() => {
      if (!options?.viewOrder) {
        return TableUpdateViewColumnMetaSpec.fromTableWithFieldId(
          nextTableResult.value,
          field.id()
        );
      }

      const viewResult = nextTableResult.value.getView(options.viewOrder.viewId);
      if (viewResult.isErr()) {
        return err(viewResult.error);
      }

      const columnMetaResult = viewResult.value.columnMeta();
      if (columnMetaResult.isErr()) {
        return err(columnMetaResult.error);
      }

      const fieldId = field.id();
      const fieldIdStr = fieldId.toString();
      const currentMeta = columnMetaResult.value.toDto();
      const nextMetaResult = ViewColumnMeta.create({
        ...currentMeta,
        [fieldIdStr]: {
          ...(currentMeta[fieldIdStr] ?? {}),
          order: options.viewOrder.order,
        },
      });
      if (nextMetaResult.isErr()) {
        return err(nextMetaResult.error);
      }

      return ok(
        TableUpdateViewColumnMetaSpec.create([
          {
            viewId: options.viewOrder.viewId,
            fieldId,
            columnMeta: nextMetaResult.value,
          },
        ])
      );
    })();
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
    newFieldId: FieldId,
    newFieldName: FieldName,
    includeRecordValues: boolean,
    options?: { targetViewId?: ViewId }
  ): TableMutateSpecBuilder {
    const newFieldResult = sourceField.duplicate({
      newId: newFieldId,
      newName: newFieldName,
      baseId: this.currentTable.baseId(),
      tableId: this.currentTable.id(),
    });
    if (newFieldResult.isErr()) {
      this.recordError(newFieldResult.error);
      return this;
    }

    const newField = newFieldResult.value;

    if (newField.dbFieldName().isOk()) {
      this.recordError(
        domainError.invariant({ message: 'Duplicated field must not carry dbFieldName' })
      );
      return this;
    }

    const copyDescriptionResult = newField.setDescription(sourceField.description());
    if (copyDescriptionResult.isErr()) {
      this.recordError(copyDescriptionResult.error);
      return this;
    }
    const copyAiConfigResult = newField.setAiConfig(sourceField.aiConfig());
    if (copyAiConfigResult.isErr()) {
      this.recordError(copyAiConfigResult.error);
      return this;
    }
    const copyNotNullResult = newField.setNotNull(sourceField.notNull());
    if (copyNotNullResult.isErr()) {
      this.recordError(copyNotNullResult.error);
      return this;
    }
    const copyUniqueResult = newField.setUnique(sourceField.unique());
    if (copyUniqueResult.isErr()) {
      this.recordError(copyUniqueResult.error);
      return this;
    }

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
    const viewSpecResult = options?.targetViewId
      ? TableUpdateViewColumnMetaSpec.forDuplicatePlacement({
          table: nextTableResult.value,
          sourceFieldId: sourceField.id(),
          newFieldId: newField.id(),
          targetViewId: options.targetViewId,
        })
      : TableUpdateViewColumnMetaSpec.fromTableWithFieldId(nextTableResult.value, newField.id());
    if (viewSpecResult.isErr()) {
      this.recordError(viewSpecResult.error);
      return this;
    }

    this.addSpec(viewSpecResult.value);
    this.currentTable = nextTableResult.value;
    return this;
  }

  updateField(
    fieldId: FieldId,
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    options?: { foreignTables?: ReadonlyArray<Table> }
  ): TableMutateSpecBuilder {
    if (specs.length === 0) {
      this.recordError(domainError.validation({ message: 'No changes to apply' }));
      return this;
    }

    const beforeErrorCount = this.errors.length;
    this.applySpecs(specs);
    if (this.errors.length > beforeErrorCount) {
      return this;
    }

    if (options?.foreignTables?.length) {
      const touchedFieldIds = new Set<string>([fieldId.toString()]);
      for (const spec of specs) {
        const maybeFieldSpec = spec as {
          fieldId?: () => {
            toString: () => string;
          };
        };
        if (typeof maybeFieldSpec.fieldId === 'function') {
          touchedFieldIds.add(maybeFieldSpec.fieldId().toString());
        }
      }

      const fieldsNeedingForeignValidation = this.currentTable.getFields().filter((field) => {
        if (!isForeignTableRelatedField(field)) {
          return false;
        }
        return touchedFieldIds.has(field.id().toString());
      });

      if (fieldsNeedingForeignValidation.length > 0) {
        const validationResult = validateForeignTablesForFields(fieldsNeedingForeignValidation, {
          hostTable: this.currentTable,
          foreignTables: options.foreignTables,
        });
        if (validationResult.isErr()) {
          this.recordError(validationResult.error);
        }
      }
    }

    return this;
  }

  applySpecs(
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
  ): TableMutateSpecBuilder {
    if (specs.length === 0) {
      return this;
    }

    for (const spec of specs) {
      const nextTableResult = spec.mutate(this.currentTable);
      if (nextTableResult.isErr()) {
        this.recordError(nextTableResult.error);
        return this;
      }

      this.addSpec(spec);
      this.currentTable = nextTableResult.value;
    }

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

  addField(
    field: Field,
    options?: {
      foreignTables?: ReadonlyArray<Table>;
      viewOrder?: {
        viewId: ViewId;
        order: number;
      };
    }
  ): TableMutator {
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

  duplicateField(
    sourceField: Field,
    newFieldId: FieldId,
    newFieldName: FieldName,
    includeRecordValues: boolean,
    options?: { targetViewId?: ViewId }
  ): TableMutator {
    this.builder.duplicateField(
      sourceField,
      newFieldId,
      newFieldName,
      includeRecordValues,
      options
    );
    this.hasUpdates = true;
    return this;
  }

  updateField(
    fieldId: FieldId,
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    options?: { foreignTables?: ReadonlyArray<Table> }
  ): TableMutator {
    this.builder.updateField(fieldId, specs, options);
    this.hasUpdates = true;
    return this;
  }

  applySpecs(specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>): TableMutator {
    if (specs.length === 0) {
      return this;
    }

    this.builder.applySpecs(specs);
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
