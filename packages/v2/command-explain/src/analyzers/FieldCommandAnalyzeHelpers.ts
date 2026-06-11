import {
  DefaultTableMapper,
  type DomainError,
  FieldOperationPluginRunner,
  NoopLogger,
  TableUpdateFlow,
  type IExecutionContext,
  type ITableRepository,
} from '@teable/v2-core';
import type { IPgTypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { SqlExplainInfo } from '../types';
import {
  CaptureTableSchemaRepository,
  NoopEventBus,
  NoopUnitOfWork,
  OverlayTableRepository,
} from '../utils/FieldCommandExplainHarness';
import { SqlExplainRunner } from '../utils/SqlExplainRunner';
import type { ComputedUpdatePlanner } from '@teable/v2-adapter-table-repository-postgres';

export type FieldExplainDryRunEnvironment = {
  overlayTableRepository: OverlayTableRepository;
  captureTableSchemaRepository: CaptureTableSchemaRepository;
  tableUpdateFlow: TableUpdateFlow;
};

export const createFieldExplainDryRunEnvironment = (input: {
  db: Kysely<V1TeableDatabase>;
  tableRepository: ITableRepository;
  computedUpdatePlanner: ComputedUpdatePlanner;
  typeValidationStrategy: IPgTypeValidationStrategy;
}): FieldExplainDryRunEnvironment => {
  const overlayTableRepository = new OverlayTableRepository(input.tableRepository);
  const captureTableSchemaRepository = new CaptureTableSchemaRepository({
    db: input.db,
    tableRepository: overlayTableRepository,
    computedUpdatePlanner: input.computedUpdatePlanner,
    typeValidationStrategy: input.typeValidationStrategy,
  });
  const tableUpdateFlow = new TableUpdateFlow(
    overlayTableRepository,
    captureTableSchemaRepository,
    new NoopEventBus(),
    new NoopUnitOfWork()
  );

  return {
    overlayTableRepository,
    captureTableSchemaRepository,
    tableUpdateFlow,
  };
};

export const createNoopUndoRedoService = () =>
  ({
    async appendEntry() {
      return ok(undefined);
    },
  }) as {
    appendEntry: (
      context: IExecutionContext,
      tableId: { toString(): string },
      entry: unknown
    ) => Promise<Result<void, DomainError>>;
  };

export const createNoopFieldOperationPluginRunner = () =>
  new FieldOperationPluginRunner([], new NoopLogger(), new DefaultTableMapper());

export const buildFieldSqlExplains = async (
  runner: SqlExplainRunner,
  db: Kysely<V1TeableDatabase>,
  statements: ReadonlyArray<{
    description: string;
    sql: string;
    parameters: ReadonlyArray<unknown>;
    explainable: boolean;
    execute: boolean;
    initialError?: string;
  }>,
  analyze: boolean
): Promise<ReadonlyArray<SqlExplainInfo>> => {
  if (statements.length === 0) {
    return [];
  }

  const sequentialResult = await runner.explainSequentialInTransaction(db, statements, analyze);
  if (sequentialResult.isErr()) {
    return statements.map((statement) => ({
      stepDescription: statement.description,
      sql: statement.sql,
      parameters: statement.parameters,
      explainAnalyze: null,
      explainOnly: null,
      explainError: sequentialResult.error.message,
    }));
  }

  return statements.map((statement, index) => {
    const result = sequentialResult.value[index];
    return {
      stepDescription: statement.description,
      sql: statement.sql,
      parameters: statement.parameters,
      explainAnalyze: result?.explainAnalyze ?? null,
      explainOnly: result?.explainOnly ?? null,
      explainError: result?.error ?? statement.initialError ?? null,
    };
  });
};
