import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../shared/specification/ISpecification';
import { SpecBuilder, type SpecBuilderMode } from '../shared/specification/SpecBuilder';
import type { ITableSpecVisitor } from './specs/ITableSpecVisitor';
import { TableByNameSpec } from './specs/TableByNameSpec';
import type { Table } from './Table';
import type { TableName } from './TableName';

class TableMutateSpecBuilder extends SpecBuilder<Table, ITableSpecVisitor, TableMutateSpecBuilder> {
  private constructor() {
    super('and');
  }

  static create(): TableMutateSpecBuilder {
    return new TableMutateSpecBuilder();
  }

  rename(tableName: TableName): TableMutateSpecBuilder {
    this.addSpec(TableByNameSpec.create(tableName));
    return this;
  }

  build(): Result<ISpecification<Table, ITableSpecVisitor>, string> {
    return this.buildFrom(this.specs);
  }

  protected createChild(_mode: SpecBuilderMode): TableMutateSpecBuilder {
    return new TableMutateSpecBuilder();
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
    this.builder = TableMutateSpecBuilder.create();
  }

  static create(table: Table): TableMutator {
    return new TableMutator(table);
  }

  rename(tableName: TableName): TableMutator {
    this.builder.rename(tableName);
    this.hasUpdates = true;
    return this;
  }

  apply(): Result<TableUpdateResult, string> {
    if (!this.hasUpdates) return err('Empty update');

    const specResult = this.builder.build();
    if (specResult.isErr()) return err(specResult.error);

    return specResult.value.mutate(this.table).map((updated) => {
      return TableUpdateResult.create(updated, specResult.value);
    });
  }
}
