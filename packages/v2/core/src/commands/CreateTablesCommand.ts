import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { TableId } from '../domain/table/TableId';
import { createTableInputSchema } from '../schemas/table/createTable.schema';
import { CreateTableCommand, type CreateTableCommandOptions } from './CreateTableCommand';

export const createTablesInputSchema = z.object({
  baseId: z.string(),
  tables: z.array(createTableInputSchema.omit({ baseId: true })).min(1),
});

export type ICreateTablesCommandInput = z.input<typeof createTablesInputSchema>;

const sequence = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<ReadonlyArray<T>, DomainError> =>
  values.reduce<Result<ReadonlyArray<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
    ok([])
  );

const collectDuplicateTableIds = (
  tables: ReadonlyArray<CreateTableCommand>
): ReadonlyArray<TableId> => {
  const seen = new Map<string, TableId>();
  const duplicates: TableId[] = [];
  for (const table of tables) {
    const tableId = table.tableId;
    if (!tableId) continue;
    const key = tableId.toString();
    if (seen.has(key)) {
      duplicates.push(tableId);
      continue;
    }
    seen.set(key, tableId);
  }
  return duplicates;
};

export class CreateTablesCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tables: ReadonlyArray<CreateTableCommand>
  ) {}

  static create(
    raw: unknown,
    options?: CreateTableCommandOptions
  ): Result<CreateTablesCommand, DomainError> {
    const parsed = createTablesInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid CreateTablesCommand input',
          details: z.formatError(parsed.error),
        })
      );

    return BaseId.create(parsed.data.baseId).andThen((baseId) => {
      const tableResults = parsed.data.tables.map((table) =>
        CreateTableCommand.create(
          {
            ...table,
            baseId: baseId.toString(),
          },
          options
        )
      );

      return sequence(tableResults).andThen((tables) => {
        const duplicates = collectDuplicateTableIds(tables);
        if (duplicates.length > 0)
          return err(
            domainError.validation({
              message: 'Duplicate tableId in CreateTablesCommand input',
            })
          );

        return ok(new CreateTablesCommand(baseId, tables));
      });
    });
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const results = this.tables.map((table) => table.foreignTableReferences());
    return sequence(results).map((refs) => refs.flat());
  }

  tableIds(): ReadonlyArray<TableId> {
    return this.tables.flatMap((table) => (table.tableId ? [table.tableId] : []));
  }
}
