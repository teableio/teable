import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { Table } from '../domain/table/Table';
import type { TableBuildOptions, TableBuilder } from '../domain/table/TableBuilder';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewName } from '../domain/table/views/ViewName';
import type { ITableFieldInput } from '../schemas/field';
import {
  collectForeignTableReferences,
  type ICreateTableFieldSpec,
  parseTableFieldSpec,
  resolveTableFieldInputs,
} from './TableFieldSpecs';

/**
 * Input for building a table from raw data.
 */
export interface TableBuildInput {
  readonly baseId: string;
  readonly tableId?: string;
  readonly name: string;
  readonly fields: ReadonlyArray<ITableFieldInput>;
  readonly views?: ReadonlyArray<{ type?: string; name?: string }>;
}

/**
 * Result of parsing table input.
 */
export interface ParsedTableInput {
  readonly baseId: BaseId;
  readonly tableId: TableId | undefined;
  readonly tableName: TableName;
  readonly fieldSpecs: ReadonlyArray<ICreateTableFieldSpec>;
  readonly viewSpecs: ReadonlyArray<ITableViewSpec>;
}

/**
 * Interface for view specifications.
 */
export interface ITableViewSpec {
  applyTo(builder: TableBuilder): void;
}

/**
 * Result of building a table.
 */
export interface TableBuildResult {
  readonly table: Table;
  readonly fieldSpecs: ReadonlyArray<ICreateTableFieldSpec>;
  readonly foreignTableReferences: ReadonlyArray<LinkForeignTableReference>;
}

// Helper to sequence Results
const sequence = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<ReadonlyArray<T>, DomainError> =>
  values.reduce<Result<ReadonlyArray<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
    ok([])
  );

// --- View Spec implementations ---

class GridViewSpec implements ITableViewSpec {
  constructor(private readonly name: ViewName) {}
  applyTo(builder: TableBuilder): void {
    builder.view().grid().withName(this.name).done();
  }
}

class KanbanViewSpec implements ITableViewSpec {
  constructor(private readonly name: ViewName) {}
  applyTo(builder: TableBuilder): void {
    builder.view().kanban().withName(this.name).done();
  }
}

class GalleryViewSpec implements ITableViewSpec {
  constructor(private readonly name: ViewName) {}
  applyTo(builder: TableBuilder): void {
    builder.view().gallery().withName(this.name).done();
  }
}

class CalendarViewSpec implements ITableViewSpec {
  constructor(private readonly name: ViewName) {}
  applyTo(builder: TableBuilder): void {
    builder.view().calendar().withName(this.name).done();
  }
}

class FormViewSpec implements ITableViewSpec {
  constructor(private readonly name: ViewName) {}
  applyTo(builder: TableBuilder): void {
    builder.view().form().withName(this.name).done();
  }
}

class PluginViewSpec implements ITableViewSpec {
  constructor(private readonly name: ViewName) {}
  applyTo(builder: TableBuilder): void {
    builder.view().plugin().withName(this.name).done();
  }
}

// --- Parsing functions ---

/**
 * Parse raw field inputs into field specifications.
 */
export function parseFieldSpecs(
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
    return err(domainError.unexpected({ message: 'Table requires exactly one primary Field' }));

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

/**
 * Parse raw view inputs into view specifications.
 */
export function parseViewSpecs(
  rawViews?: ReadonlyArray<{ type?: string; name?: string }>
): Result<ReadonlyArray<ITableViewSpec>, DomainError> {
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
        .with('grid', () => ok(new GridViewSpec(name) as ITableViewSpec))
        .with('kanban', () => ok(new KanbanViewSpec(name) as ITableViewSpec))
        .with('gallery', () => ok(new GalleryViewSpec(name) as ITableViewSpec))
        .with('calendar', () => ok(new CalendarViewSpec(name) as ITableViewSpec))
        .with('form', () => ok(new FormViewSpec(name) as ITableViewSpec))
        .with('plugin', () => ok(new PluginViewSpec(name) as ITableViewSpec))
        .otherwise(() => err(domainError.validation({ message: 'Unsupported view type' })));
    });
  });

  return sequence(specs);
}

/**
 * Parse table input into structured components.
 */
export function parseTableInput(input: TableBuildInput): Result<ParsedTableInput, DomainError> {
  const tableIdResult: Result<TableId | undefined, DomainError> = input.tableId
    ? TableId.create(input.tableId)
    : ok<TableId | undefined, DomainError>(undefined);

  return BaseId.create(input.baseId).andThen((baseId) =>
    tableIdResult.andThen((tableId) =>
      TableName.create(input.name).andThen((tableName) =>
        parseFieldSpecs(input.fields).andThen((fieldSpecs) =>
          parseViewSpecs(input.views).map((viewSpecs) => ({
            baseId,
            tableId,
            tableName,
            fieldSpecs,
            viewSpecs,
          }))
        )
      )
    )
  );
}

/**
 * Build a Table domain object from parsed input.
 */
export function buildTableFromParsedInput(
  parsed: ParsedTableInput,
  options?: TableBuildOptions
): Result<Table, DomainError> {
  const builder = Table.builder().withBaseId(parsed.baseId).withName(parsed.tableName);

  if (parsed.tableId) {
    builder.withId(parsed.tableId);
  }

  for (const fieldSpec of parsed.fieldSpecs) {
    fieldSpec.applyTo(builder);
  }

  for (const viewSpec of parsed.viewSpecs) {
    viewSpec.applyTo(builder);
  }

  return builder.build(options);
}

/**
 * Build a Table from raw input data.
 *
 * This is the main entry point for building a Table without using CreateTableCommand.
 * It handles parsing, validation, and Table construction in one call.
 */
export function buildTableFromInput(
  input: TableBuildInput,
  options?: TableBuildOptions
): Result<TableBuildResult, DomainError> {
  return parseTableInput(input).andThen((parsed) =>
    collectForeignTableReferences(parsed.fieldSpecs).andThen((foreignTableReferences) =>
      buildTableFromParsedInput(parsed, options).map((table) => ({
        table,
        fieldSpecs: parsed.fieldSpecs,
        foreignTableReferences,
      }))
    )
  );
}
