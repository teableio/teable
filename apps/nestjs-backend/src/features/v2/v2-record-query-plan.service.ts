import { Injectable } from '@nestjs/common';
import { PostgresTableRecordQueryRepository } from '@teable/v2-adapter-table-repository-postgres';
import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import {
  FieldKeyResolverService,
  FieldKeyType,
  ListTableRecordsHandler,
  ListTableRecordsQuery,
  RecordQueryOperationKind,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type DomainError,
  type ITableRepository,
  type RecordQueryPluginRunner,
  type RecordQueryPluginScope,
} from '@teable/v2-core';
import type { Knex } from 'knex';
import type { Result } from 'neverthrow';

import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';
import { throwV2Error } from './v2-http-error';

export interface ICompiledRecordQueryPlan {
  readonly sql: string;
  readonly parameters: ReadonlyArray<unknown>;
}

export type NativeRecordQueryInput = Partial<
  Pick<
    ListTableRecordsQuery,
    | 'viewId'
    | 'ignoreViewQuery'
    | 'filter'
    | 'sort'
    | 'projection'
    | 'fieldKeyType'
    | 'search'
    | 'groupBy'
  >
>;

function unwrap<T>(result: Result<T, DomainError>): T {
  if (result.isErr()) {
    throwV2Error(mapDomainErrorToHttpError(result.error), mapDomainErrorToHttpStatus(result.error));
  }
  return result.value;
}

/** Authorized SQL sources share list planning and the actual native read compiler. */
@Injectable()
export class V2RecordQueryPlanService {
  constructor(
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory
  ) {}

  compile(
    tableId: string,
    query: NativeRecordQueryInput = {},
    options: { readonly order?: 'query' | 'none' } = {}
  ): Promise<ICompiledRecordQueryPlan> {
    return this.compileSource(tableId, query, options.order === 'none', false);
  }

  /** Schema DDL only: persistent views cannot capture an individual actor's authority. */
  compileDatabaseView(tableId: string): Promise<ICompiledRecordQueryPlan> {
    return this.compileSource(tableId, { ignoreViewQuery: true }, true, true);
  }

  private async compileSource(
    tableId: string,
    input: NativeRecordQueryInput,
    omitOrder: boolean,
    schemaDefinition: boolean
  ): Promise<ICompiledRecordQueryPlan> {
    const container = await this.containers.getContainerForTable(tableId);
    const context = await this.contexts.createContext(container);
    const tables = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const id = unwrap(TableId.create(tableId));
    const table = unwrap(await tables.findOne(context, TableByIdSpec.create(id)));
    const queryInput = { fieldKeyType: FieldKeyType.Id, ...input, tableId };
    const validatedQuery = unwrap(ListTableRecordsQuery.create(queryInput, { table }));
    const projectionFieldIds = validatedQuery.projection?.map((key) =>
      unwrap(FieldKeyResolverService.resolveFieldKey(table, key, validatedQuery.fieldKeyType))
    );
    let queryScope: RecordQueryPluginScope | undefined;
    if (!schemaDefinition) {
      const runner = container.resolve<RecordQueryPluginRunner>(
        v2CoreTokens.recordQueryPluginRunner
      );
      const execution = unwrap(
        await runner.prepare({
          kind: RecordQueryOperationKind.list,
          executionContext: context,
          table,
          payload: {
            viewId: validatedQuery.viewId,
            ignoreViewQuery: validatedQuery.ignoreViewQuery,
            projectionFieldIds,
          },
        })
      );
      unwrap(await execution.guard());
      queryScope = unwrap(execution.getScope());
    }
    const query = unwrap(ListTableRecordsQuery.create(queryInput, { table, queryScope }));
    const handler = container.resolve(ListTableRecordsHandler);
    const plan = unwrap(await handler.prepare(context, query));
    // The core query token can be decorated with an execution-only observation wrapper.
    const repository = container.resolve(PostgresTableRecordQueryRepository);
    return unwrap(
      await repository.compileRead(
        context,
        plan.table,
        plan.options.spec,
        {
          ...plan.options.query,
          pagination: undefined,
          cursor: undefined,
          includeTotal: false,
        },
        { fieldIds: plan.outputFieldIds, omitOrder }
      )
    );
  }
}

/** Rebind PostgreSQL positional values without touching quoted SQL or identifiers. */
export function toKnexRecordQuery(knex: Knex, plan: ICompiledRecordQueryPlan): Knex.Raw {
  const bindings: unknown[] = [];
  let text = '';
  let cursor = 0;
  while (cursor < plan.sql.length) {
    const remaining = plan.sql.slice(cursor);
    const character = plan.sql[cursor];
    if (character === "'" || character === '"') {
      const quote = character;
      let end = cursor + 1;
      while (end < plan.sql.length) {
        if (plan.sql[end] === quote) {
          if (plan.sql[end + 1] === quote) {
            end += 2;
            continue;
          }
          end++;
          break;
        }
        // PostgreSQL E'...' strings can contain escaped quotes.
        if (
          quote === "'" &&
          plan.sql[end] === '\\' &&
          cursor > 0 &&
          /[eE]/.test(plan.sql[cursor - 1]) &&
          (cursor < 2 || !/[\w$]/.test(plan.sql[cursor - 2]))
        ) {
          end += 2;
        } else {
          end++;
        }
      }
      text += plan.sql.slice(cursor, end).replaceAll('?', '\\?');
      cursor = end;
      continue;
    }
    const dollarQuote = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(remaining)?.[0];
    if (dollarQuote) {
      const close = plan.sql.indexOf(dollarQuote, cursor + dollarQuote.length);
      if (close < 0) throw new Error('Unterminated dollar quote in native record query');
      const end = close + dollarQuote.length;
      text += plan.sql.slice(cursor, end).replaceAll('?', '\\?');
      cursor = end;
      continue;
    }
    if (remaining.startsWith('--') || remaining.startsWith('/*')) {
      let end: number;
      if (remaining.startsWith('--')) {
        const newline = plan.sql.indexOf('\n', cursor + 2);
        end = newline < 0 ? plan.sql.length : newline;
      } else {
        let depth = 1;
        end = cursor + 2;
        while (end < plan.sql.length && depth > 0) {
          if (plan.sql.startsWith('/*', end)) {
            depth++;
            end += 2;
          } else if (plan.sql.startsWith('*/', end)) {
            depth--;
            end += 2;
          } else end++;
        }
        if (depth) throw new Error('Unterminated comment in native record query');
      }
      text += plan.sql.slice(cursor, end).replaceAll('?', '\\?');
      cursor = end;
      continue;
    }
    const parameter = /^\$(\d+)/.exec(remaining);
    if (parameter) {
      const index = Number(parameter[1]) - 1;
      if (index < 0 || index >= plan.parameters.length) {
        throw new Error('Missing native record query parameter');
      }
      bindings.push(plan.parameters[index]);
      text += '?';
      cursor += parameter[0].length;
      continue;
    }
    text += character === '?' ? '\\?' : character;
    cursor++;
  }
  return knex.raw(text, bindings as Knex.RawBinding[]);
}
