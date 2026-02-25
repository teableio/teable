import type { Result } from 'neverthrow';

import type { BaseId } from '../../base/BaseId';
import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import { SpecBuilder } from '../../shared/specification/SpecBuilder';
import type { SpecBuilderMode } from '../../shared/specification/SpecBuilder';
import type { Table } from '../Table';
import type { TableId } from '../TableId';
import type { TableName } from '../TableName';
import type { ITableSpecVisitor } from './ITableSpecVisitor';
import { TableByBaseIdSpec } from './TableByBaseIdSpec';
import { TableByIdSpec } from './TableByIdSpec';
import { TableByIdsSpec } from './TableByIdsSpec';
import { TableByNameLikeSpec } from './TableByNameLikeSpec';
import { TableByNameSpec } from './TableByNameSpec';

export class TableSpecBuilder extends SpecBuilder<Table, ITableSpecVisitor, TableSpecBuilder> {
  private includeBaseId = true;

  private constructor(
    private readonly baseIdValue: BaseId | undefined,
    mode: SpecBuilderMode = 'and'
  ) {
    super(mode);
    // If no baseId provided, don't include it in the query
    if (!baseIdValue) {
      this.includeBaseId = false;
    }
  }

  static create(baseId?: BaseId): TableSpecBuilder {
    return new TableSpecBuilder(baseId, 'and');
  }

  withoutBaseId(): TableSpecBuilder {
    this.includeBaseId = false;
    return this;
  }

  byBaseId(baseId?: BaseId): TableSpecBuilder {
    const id = baseId ?? this.baseIdValue;
    if (id) {
      this.includeBaseId = false;
      this.addSpec(TableByBaseIdSpec.create(id));
    }
    return this;
  }

  byId(tableId: TableId): TableSpecBuilder {
    this.addSpec(TableByIdSpec.create(tableId));
    return this;
  }

  byIds(tableIds: ReadonlyArray<TableId>): TableSpecBuilder {
    this.addSpec(TableByIdsSpec.create(tableIds));
    return this;
  }

  byName(tableName: TableName): TableSpecBuilder {
    this.addSpec(TableByNameSpec.create(tableName));
    return this;
  }

  byNameLike(tableName: TableName): TableSpecBuilder {
    this.addSpec(TableByNameLikeSpec.create(tableName));
    return this;
  }

  andGroup(build: (builder: TableSpecBuilder) => TableSpecBuilder): TableSpecBuilder {
    this.addGroup('and', build);
    return this;
  }

  orGroup(build: (builder: TableSpecBuilder) => TableSpecBuilder): TableSpecBuilder {
    this.addGroup('or', build);
    return this;
  }

  not(build: (builder: TableSpecBuilder) => TableSpecBuilder): TableSpecBuilder {
    const nested = build(this.createChild('and'));
    const result = nested.build();
    result.match(
      (spec) => this.addNotSpec(spec),
      (error) => this.recordError(error)
    );
    return this;
  }

  build(): Result<ISpecification<Table, ITableSpecVisitor>, DomainError> {
    const specs =
      this.includeBaseId && this.baseIdValue
        ? [TableByBaseIdSpec.create(this.baseIdValue), ...this.specs]
        : [...this.specs];
    return this.buildFrom(specs);
  }

  protected createChild(mode: SpecBuilderMode): TableSpecBuilder {
    const builder = new TableSpecBuilder(this.baseIdValue, mode);
    builder.includeBaseId = false;
    return builder;
  }
}
