import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../shared/specification/ISpecification';
import { SpecBuilder, type SpecBuilderMode } from '../shared/specification/SpecBuilder';
import type { Field } from './fields/Field';
import type { ITableSpecVisitor } from './specs/ITableSpecVisitor';
import { TableAddFieldSpec } from './specs/TableAddFieldSpec';
import { TableByNameSpec } from './specs/TableByNameSpec';
import { TableUpdateViewColumnMetaSpec } from './specs/TableUpdateViewColumnMetaSpec';
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
    const nextTableResult = this.currentTable.rename(tableName);
    if (nextTableResult.isErr()) {
      this.recordError(nextTableResult.error);
      return this;
    }

    this.addSpec(TableByNameSpec.create(tableName));
    this.currentTable = nextTableResult.value;
    return this;
  }

  addField(field: Field): TableMutateSpecBuilder {
    const nextTableResult = this.currentTable.addField(field);
    if (nextTableResult.isErr()) {
      this.recordError(nextTableResult.error);
      return this;
    }

    this.addSpec(TableAddFieldSpec.create(field));
    const viewSpecResult = TableUpdateViewColumnMetaSpec.fromTable(nextTableResult.value);
    if (viewSpecResult.isErr()) {
      this.recordError(viewSpecResult.error);
      return this;
    }

    this.addSpec(viewSpecResult.value);
    this.currentTable = nextTableResult.value;
    return this;
  }

  build(): Result<ISpecification<Table, ITableSpecVisitor>, string> {
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

  addField(field: Field): TableMutator {
    this.builder.addField(field);
    this.hasUpdates = true;
    return this;
  }

  apply(): Result<TableUpdateResult, string> {
    if (!this.hasUpdates) return err('Empty update');

    const specResult = this.builder.build();
    if (specResult.isErr()) return err(specResult.error);

    return specResult.value
      .mutate(this.table)
      .map((updated) => TableUpdateResult.create(updated, specResult.value));
  }
}
