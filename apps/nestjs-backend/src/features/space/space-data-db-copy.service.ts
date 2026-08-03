import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { Injectable } from '@nestjs/common';
import {
  buildBaseSchemaDumpRestorePlan,
  buildBaseSchemaDumpStreamRestorePlan,
  buildBaseSchemaPgcopydbPlan,
  buildBaseSchemaRestoreListPlan,
  buildBaseSchemaRestorePlan,
  type ISpaceDataDbDumpStreamRestorePlan,
  type ISharedTablePostgresFdwCopyPlan,
  type ISharedTablePsqlCopyPlan,
  type ISpaceDataDbDumpRestorePlan,
  type ISpaceDataDbPgcopydbPlan,
} from './space-data-db-copy-plan';
import {
  SpaceDataDbProcessRunnerService,
  type ISpaceDataDbProcessPipelineResult,
  type ISpaceDataDbProcessRunOptions,
  type ISpaceDataDbProcessRunResult,
} from './space-data-db-process-runner.service';

export const REQUIRED_POSTGRES_COPY_TOOLS = ['pg_dump', 'pg_restore', 'psql'] as const;
export const REQUIRED_PGCOPYDB_COPY_TOOLS = [...REQUIRED_POSTGRES_COPY_TOOLS, 'pgcopydb'] as const;
export const PG_RESTORE_LIST_STDOUT_LIMIT = 64 * 1024 * 1024;

export type ISpaceDataDbBaseSchemaCopyStrategy =
  | 'pg_dump_restore'
  | 'pg_dump_stream_restore'
  | 'pgcopydb';
export type ISpaceDataDbSharedTableCopyStrategy = 'psql_copy' | 'postgres_fdw';

export type ISpaceDataDbExcludedForeignKey = {
  schemaName: string;
  tableName: string;
  constraintName: string;
  referencedSchemaName: string;
  referencedTableName: string;
};

export type ISpaceDataDbFilteredRestoreList = {
  restoreListFile: string;
  requestedForeignKeyCount: number;
  excludedEntryCount: number;
  excludedForeignKeys: ISpaceDataDbExcludedForeignKey[];
};

export type ISpaceDataDbBaseSchemaCopyResult = {
  strategy: ISpaceDataDbBaseSchemaCopyStrategy;
  plan: ISpaceDataDbDumpRestorePlan | ISpaceDataDbDumpStreamRestorePlan | ISpaceDataDbPgcopydbPlan;
  dump?: ISpaceDataDbProcessRunResult;
  stream?: ISpaceDataDbProcessPipelineResult;
  restoreList?: ISpaceDataDbProcessRunResult;
  filteredRestoreList?: ISpaceDataDbFilteredRestoreList;
  restore?: ISpaceDataDbProcessRunResult;
  pgcopydb?: ISpaceDataDbProcessRunResult;
};

export type ISpaceDataDbSharedTableCopyResult = ISpaceDataDbProcessPipelineResult & {
  strategy?: ISpaceDataDbSharedTableCopyStrategy;
  table: string;
  copiedRows: number | null;
};

export type ISpaceDataDbPostgresFdwSharedTableCopyResult = {
  strategy: 'postgres_fdw';
  table: string;
  copiedRows: number | null;
  target: ISpaceDataDbProcessRunResult;
};

type ISpaceDataDbSharedTableCopyHooks = {
  onTableCopied?: (
    result: ISpaceDataDbSharedTableCopyResult,
    index: number,
    total: number
  ) => void | Promise<void>;
};

type ISpaceDataDbBaseSchemaCopyHooks = {
  onDumpProgressPoll?: () => void | Promise<void>;
  onRestoreProgressPoll?: () => void | Promise<void>;
};

const withProgressPoll = (
  options: ISpaceDataDbProcessRunOptions | undefined,
  onPoll: (() => void | Promise<void>) | undefined
): ISpaceDataDbProcessRunOptions | undefined => {
  if (!onPoll) {
    return options;
  }
  return {
    ...options,
    onPoll: async () => {
      await options?.onPoll?.();
      await onPoll();
    },
  };
};

const withMinimumStdoutLimit = (
  options: ISpaceDataDbProcessRunOptions | undefined,
  stdoutLimit: number
): ISpaceDataDbProcessRunOptions => ({
  ...options,
  stdoutLimit: Math.max(options?.stdoutLimit ?? 0, stdoutLimit),
});

export const parsePsqlCopyRowCount = (output: string): number | null => {
  const matches = [...output.matchAll(/^COPY\s+(\d+)\s*$/gim)];
  const last = matches.at(-1)?.[1];
  if (last == null) {
    return null;
  }
  const value = Number(last);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

export const parsePsqlInsertRowCount = (output: string): number | null => {
  const matches = [...output.matchAll(/^INSERT\s+\d+\s+(\d+)\s*$/gim)];
  const last = matches.at(-1)?.[1];
  if (last == null) {
    return null;
  }
  const value = Number(last);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

export const postgresCopyToolsForStrategy = (strategy: ISpaceDataDbBaseSchemaCopyStrategy) =>
  strategy === 'pgcopydb' ? [...REQUIRED_PGCOPYDB_COPY_TOOLS] : [...REQUIRED_POSTGRES_COPY_TOOLS];

export const pgRestoreListEntryMatchesForeignKey = (
  line: string,
  foreignKey: ISpaceDataDbExcludedForeignKey
) => {
  if (!line.includes(' FK CONSTRAINT ')) {
    return false;
  }

  const tokens = line.trim().split(/\s+/);
  return (
    tokens.includes(foreignKey.schemaName) &&
    tokens.includes(foreignKey.tableName) &&
    tokens.includes(foreignKey.constraintName)
  );
};

export const filterPgRestoreListForForeignKeys = (
  content: string,
  foreignKeys: ISpaceDataDbExcludedForeignKey[]
) => {
  if (!foreignKeys.length) {
    return { content, excludedEntryCount: 0 };
  }

  let excludedEntryCount = 0;
  const filteredLines = content.split(/\r?\n/).filter((line) => {
    const shouldExclude = foreignKeys.some((foreignKey) =>
      pgRestoreListEntryMatchesForeignKey(line, foreignKey)
    );
    if (shouldExclude) {
      excludedEntryCount += 1;
    }
    return !shouldExclude;
  });

  return {
    content: filteredLines.join('\n'),
    excludedEntryCount,
  };
};

@Injectable()
export class SpaceDataDbCopyService {
  constructor(private readonly processRunner: SpaceDataDbProcessRunnerService) {}

  async assertPostgresToolsAvailable(
    strategy: ISpaceDataDbBaseSchemaCopyStrategy = 'pg_dump_restore',
    processOptions?: ISpaceDataDbProcessRunOptions
  ): Promise<ISpaceDataDbProcessRunResult[]> {
    const results: ISpaceDataDbProcessRunResult[] = [];
    for (const command of postgresCopyToolsForStrategy(strategy)) {
      results.push(await this.processRunner.run({ command, args: ['--version'] }, processOptions));
    }
    return results;
  }

  async copyBaseSchemas(input: {
    sourceUrl: string;
    targetUrl: string;
    schemaNames: string[];
    workDir: string;
    jobs?: number;
    strategy?: ISpaceDataDbBaseSchemaCopyStrategy;
    snapshotId?: string;
    excludedForeignKeys?: ISpaceDataDbExcludedForeignKey[];
    processOptions?: ISpaceDataDbProcessRunOptions;
    hooks?: ISpaceDataDbBaseSchemaCopyHooks;
  }): Promise<ISpaceDataDbBaseSchemaCopyResult> {
    const excludedForeignKeys = input.excludedForeignKeys ?? [];
    const requestedStrategy = input.strategy ?? 'pg_dump_stream_restore';
    const strategy =
      requestedStrategy === 'pg_dump_stream_restore' && excludedForeignKeys.length
        ? 'pg_dump_restore'
        : requestedStrategy;
    if (strategy === 'pgcopydb') {
      if (input.snapshotId) {
        throw new Error(
          'pgcopydb base schema copy does not support exported PostgreSQL snapshots; use pg_dump_stream_restore or pg_dump_restore'
        );
      }
      if (excludedForeignKeys.length) {
        throw new Error(
          'pgcopydb base schema copy does not support filtering out-of-space foreign keys; use pg_dump_restore for this migration'
        );
      }
      const plan = buildBaseSchemaPgcopydbPlan(input);
      await mkdir(input.workDir, { recursive: true });
      await writeFile(plan.filterFile, plan.filterFileContent, 'utf8');
      const pgcopydb = await this.processRunner.run(plan.copy, input.processOptions);
      return {
        strategy,
        plan,
        pgcopydb,
      };
    }

    if (strategy === 'pg_dump_stream_restore' && !excludedForeignKeys.length) {
      const plan = buildBaseSchemaDumpStreamRestorePlan(input);
      const onPoll =
        input.hooks?.onDumpProgressPoll || input.hooks?.onRestoreProgressPoll
          ? async () => {
              await input.hooks?.onDumpProgressPoll?.();
              await input.hooks?.onRestoreProgressPoll?.();
            }
          : undefined;
      const stream = await this.processRunner.runPipeline(
        plan,
        withProgressPoll(input.processOptions, onPoll)
      );
      return {
        strategy,
        plan,
        stream,
      };
    }

    const plan = buildBaseSchemaDumpRestorePlan(input);
    const dump = await this.processRunner.run(
      plan.dump,
      withProgressPoll(input.processOptions, input.hooks?.onDumpProgressPoll)
    );
    let restoreList: ISpaceDataDbProcessRunResult | undefined;
    let filteredRestoreList: ISpaceDataDbFilteredRestoreList | undefined;
    if (excludedForeignKeys.length) {
      plan.restoreList = buildBaseSchemaRestoreListPlan(plan.dumpFile);
      restoreList = await this.processRunner.run(
        plan.restoreList,
        withMinimumStdoutLimit(input.processOptions, PG_RESTORE_LIST_STDOUT_LIMIT)
      );
      const restoreListFile = path.join(input.workDir, 'base-schemas.restore.list');
      const filtered = filterPgRestoreListForForeignKeys(restoreList.stdout, excludedForeignKeys);
      await mkdir(input.workDir, { recursive: true });
      await writeFile(restoreListFile, filtered.content, 'utf8');
      plan.restoreListFile = restoreListFile;
      plan.restore = buildBaseSchemaRestorePlan({
        targetUrl: input.targetUrl,
        dumpFile: plan.dumpFile,
        jobs: input.jobs,
        restoreListFile,
      });
      filteredRestoreList = {
        restoreListFile,
        requestedForeignKeyCount: excludedForeignKeys.length,
        excludedEntryCount: filtered.excludedEntryCount,
        excludedForeignKeys,
      };
    }
    const restore = await this.processRunner.run(
      plan.restore,
      withProgressPoll(input.processOptions, input.hooks?.onRestoreProgressPoll)
    );

    return {
      strategy,
      plan,
      dump,
      restoreList,
      filteredRestoreList,
      restore,
    };
  }

  async copySharedTable(
    plan: ISharedTablePsqlCopyPlan,
    processOptions?: ISpaceDataDbProcessRunOptions
  ): Promise<ISpaceDataDbSharedTableCopyResult> {
    const result = await this.processRunner.runPipeline(plan, processOptions);
    return {
      strategy: 'psql_copy',
      table: plan.table,
      copiedRows: parsePsqlCopyRowCount(`${result.target.stdout}\n${result.target.stderr}`),
      ...result,
    };
  }

  async copySharedTables(
    plans: ISharedTablePsqlCopyPlan[],
    processOptions?: ISpaceDataDbProcessRunOptions,
    hooks: ISpaceDataDbSharedTableCopyHooks = {}
  ): Promise<ISpaceDataDbSharedTableCopyResult[]> {
    const results: ISpaceDataDbSharedTableCopyResult[] = [];
    for (const [index, plan] of plans.entries()) {
      const result = await this.copySharedTable(plan, processOptions);
      results.push(result);
      await hooks.onTableCopied?.(result, index, plans.length);
    }
    return results;
  }

  async copySharedTableViaPostgresFdw(
    plan: ISharedTablePostgresFdwCopyPlan,
    processOptions?: ISpaceDataDbProcessRunOptions
  ): Promise<ISpaceDataDbPostgresFdwSharedTableCopyResult> {
    const target = await this.processRunner.run(plan.target, processOptions);
    return {
      strategy: 'postgres_fdw',
      table: plan.table,
      copiedRows: parsePsqlInsertRowCount(`${target.stdout}\n${target.stderr}`),
      target,
    };
  }

  async copySharedTablesViaPostgresFdw(
    plans: ISharedTablePostgresFdwCopyPlan[],
    processOptions?: ISpaceDataDbProcessRunOptions,
    hooks: {
      onTableCopied?: (
        result: ISpaceDataDbPostgresFdwSharedTableCopyResult,
        index: number,
        total: number
      ) => void | Promise<void>;
    } = {}
  ): Promise<ISpaceDataDbPostgresFdwSharedTableCopyResult[]> {
    const results: ISpaceDataDbPostgresFdwSharedTableCopyResult[] = [];
    for (const [index, plan] of plans.entries()) {
      const result = await this.copySharedTableViaPostgresFdw(plan, processOptions);
      results.push(result);
      await hooks.onTableCopied?.(result, index, plans.length);
    }
    return results;
  }
}
