import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { Table } from '../domain/table/Table';
import type { TableBuildOptions, TableBuilder } from '../domain/table/TableBuilder';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewName } from '../domain/table/views/ViewName';
import {
  collectForeignTableReferences,
  type ICreateTableFieldSpec,
  type ITableFieldInput,
  parseTableFieldSpec,
  resolveTableFieldInputs,
  tableFieldInputSchema,
} from './TableFieldSpecs';

export const createTableInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string().optional(),
  name: z.string(),
  fields: z.array(tableFieldInputSchema).default([]),
  views: z
    .array(
      z.object({
        type: z.enum(['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin']).optional(),
        name: z.string().optional(),
      })
    )
    .optional(),
});

export type ICreateTableCommandInput = z.input<typeof createTableInputSchema>;

export interface ICreateTableViewSpec {
  applyTo(builder: TableBuilder): void;
}

class CreateGridViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateGridViewSpec {
    return new CreateGridViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().grid().withName(this.name).done();
  }
}

class CreateKanbanViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateKanbanViewSpec {
    return new CreateKanbanViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().kanban().withName(this.name).done();
  }
}

class CreateGalleryViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateGalleryViewSpec {
    return new CreateGalleryViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().gallery().withName(this.name).done();
  }
}

class CreateCalendarViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateCalendarViewSpec {
    return new CreateCalendarViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().calendar().withName(this.name).done();
  }
}

class CreateFormViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateFormViewSpec {
    return new CreateFormViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().form().withName(this.name).done();
  }
}

class CreatePluginViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreatePluginViewSpec {
    return new CreatePluginViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().plugin().withName(this.name).done();
  }
}

const sequence = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<ReadonlyArray<T>, DomainError> =>
  values.reduce<Result<ReadonlyArray<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
    ok([])
  );

export class CreateTableCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId | undefined,
    readonly tableName: TableName,
    readonly fields: ReadonlyArray<ICreateTableFieldSpec>,
    readonly views: ReadonlyArray<ICreateTableViewSpec>
  ) {}

  static create(raw: unknown): Result<CreateTableCommand, DomainError> {
    const parsed = createTableInputSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.fromMessage('Invalid CreateTableCommand input'));

    const tableIdResult: Result<TableId | undefined, DomainError> = parsed.data.tableId
      ? TableId.create(parsed.data.tableId)
      : ok<TableId | undefined, DomainError>(undefined);

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      tableIdResult.andThen((tableId) =>
        TableName.create(parsed.data.name).andThen((tableName) =>
          this.parseFields(parsed.data.fields)
            .andThen((fields) =>
              this.parseViews(parsed.data.views).map((views) => ({ fields, views }))
            )
            .map(
              ({ fields, views }) =>
                new CreateTableCommand(baseId, tableId, tableName, fields, views)
            )
        )
      )
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return collectForeignTableReferences(this.fields);
  }

  private static parseFields(
    rawFields: ReadonlyArray<ITableFieldInput>
  ): Result<ReadonlyArray<ICreateTableFieldSpec>, DomainError> {
    const fieldsToUse =
      rawFields.length > 0
        ? rawFields
        : [{ type: 'singleLineText' as const, name: 'Name', isPrimary: true }];

    const primaryIndexes = fieldsToUse
      .map((f, i) => ({ isPrimary: f.isPrimary === true, i }))
      .filter((x) => x.isPrimary)
      .map((x) => x.i);

    if (primaryIndexes.length > 1)
      return err(domainError.fromMessage('CreateTableCommand requires exactly one primary Field'));

    const primaryIndex = primaryIndexes[0] ?? 0;

    const fieldsWithPrimaryFlag = fieldsToUse.map((field, index) =>
      index === primaryIndex && field.isPrimary !== true ? { ...field, isPrimary: true } : field
    );

    return resolveTableFieldInputs(fieldsWithPrimaryFlag, []).andThen((resolvedFields) => {
      const specs = resolvedFields.map((field, index) =>
        parseTableFieldSpec(field, { isPrimary: index === primaryIndex })
      );

      return sequence(specs);
    });
  }

  private static parseViews(
    rawViews: z.output<typeof createTableInputSchema>['views']
  ): Result<ReadonlyArray<ICreateTableViewSpec>, DomainError> {
    const viewsToUse =
      rawViews && rawViews.length > 0 ? rawViews : [{ type: 'grid' as const, name: 'Grid' }];

    const defaultViewNameByType = (type: string): string =>
      match(type)
        .with('calendar', () => 'Calendar')
        .with('kanban', () => 'Kanban')
        .with('form', () => 'Form')
        .with('gallery', () => 'Gallery')
        .with('plugin', () => 'Plugin')
        .otherwise(() => 'Grid');

    const specs = viewsToUse.map((view) => {
      const type = view.type ?? 'grid';
      const rawName = view.name ?? defaultViewNameByType(type);

      return ViewName.create(rawName).andThen((name) => {
        return match(type)
          .with('grid', () => ok(CreateGridViewSpec.create(name)))
          .with('kanban', () => ok(CreateKanbanViewSpec.create(name)))
          .with('gallery', () => ok(CreateGalleryViewSpec.create(name)))
          .with('calendar', () => ok(CreateCalendarViewSpec.create(name)))
          .with('form', () => ok(CreateFormViewSpec.create(name)))
          .with('plugin', () => ok(CreatePluginViewSpec.create(name)))
          .otherwise(() => err(domainError.fromMessage('Unsupported view type')));
      });
    });

    return sequence(specs);
  }
}

export function buildTable(
  command: CreateTableCommand,
  options?: TableBuildOptions
): Result<Table, DomainError> {
  const builder = Table.builder().withBaseId(command.baseId).withName(command.tableName);
  if (command.tableId) {
    builder.withId(command.tableId);
  }

  for (const fieldSpec of command.fields) {
    fieldSpec.applyTo(builder);
  }

  for (const viewSpec of command.views) {
    viewSpec.applyTo(builder);
  }

  return builder.build(options);
}
