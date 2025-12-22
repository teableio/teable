import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { BaseId } from '../base/BaseId';
import { AggregateRoot } from '../shared/AggregateRoot';

import { topologicalSort } from '../shared/graph/topologicalSort';
import { DbTableName } from './DbTableName';
import { TableCreated } from './events/TableCreated';
import type { Field } from './fields/Field';
import type { FieldId } from './fields/FieldId';
import { TableSpecBuilder } from './specs/TableSpecBuilder';
import type { ITableBuildProps } from './TableBuilder';
import { TableBuilder } from './TableBuilder';
import type { TableId } from './TableId';
import type { TableName } from './TableName';
import type { View } from './views/View';
import type { ViewId } from './views/ViewId';

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

  static specs(baseId: BaseId, options?: { includeBaseId?: boolean }): TableSpecBuilder {
    return TableSpecBuilder.create(baseId, options);
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

  viewIds(): ReadonlyArray<ViewId> {
    return this.viewsValue.map((v) => v.id());
  }
}
