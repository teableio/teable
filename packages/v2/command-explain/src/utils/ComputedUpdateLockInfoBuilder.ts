import type { Table } from '@teable/v2-core';
import {
  buildComputedUpdateLockPlan,
  defaultComputedUpdateLockConfig,
  type ComputedUpdateLockConfig,
  type ComputedUpdatePlan,
} from '@teable/v2-adapter-table-repository-postgres';

import type {
  ComputedUpdateLockInfo,
  ComputedUpdateLockBatchInfo,
  ComputedUpdateLockRecordInfo,
  ComputedUpdateLockStatementInfo,
  ComputedUpdateLockTableInfo,
} from '../types';

export const buildComputedUpdateLockInfo = (params: {
  plan: ComputedUpdatePlan;
  tableById: Map<string, Table>;
  hasSteps: boolean;
  config?: ComputedUpdateLockConfig;
}): ComputedUpdateLockInfo => {
  const config = params.config ?? defaultComputedUpdateLockConfig;
  if (!params.hasSteps) {
    return {
      mode: 'none',
      reason: 'no computed steps to lock',
      maxRecordLocks: config.maxRecordLocks,
      batchShardCount: config.batchShardCount,
      seedRecordCount: 0,
      recordLockCount: 0,
      batchLockCount: 0,
      tableLockCount: 0,
      tableLockTableIds: [],
      recordLocks: [],
      batchLocks: [],
      tableLocks: [],
      statements: [],
    };
  }

  const lockPlan = buildComputedUpdateLockPlan(params.plan, config);
  const getTableName = (tableId: string): string => {
    const table = params.tableById.get(tableId);
    return table ? table.name().toString() : tableId;
  };

  const recordLocks: ComputedUpdateLockRecordInfo[] = lockPlan.recordLocks.map((lock) => ({
    tableId: lock.tableId,
    tableName: getTableName(lock.tableId),
    recordId: lock.recordId,
    key: lock.key,
  }));

  const batchLocks: ComputedUpdateLockBatchInfo[] = lockPlan.batchLocks.map((lock) => ({
    tableId: lock.tableId,
    tableName: getTableName(lock.tableId),
    batchId: lock.batchId,
    recordCount: lock.recordCount,
    key: lock.key,
  }));

  const tableLocks: ComputedUpdateLockTableInfo[] = lockPlan.tableLocks.map((lock) => ({
    tableId: lock.tableId,
    tableName: getTableName(lock.tableId),
    key: lock.key,
  }));

  const statements: ComputedUpdateLockStatementInfo[] = lockPlan.statements.map((statement) => ({
    scope: statement.scope,
    tableId: statement.tableId,
    tableName: getTableName(statement.tableId),
    recordId: statement.recordId,
    batchId: statement.batchId,
    key: statement.key,
    sql: statement.sql,
    parameters: statement.parameters,
  }));

  return {
    mode: lockPlan.summary.mode,
    reason: lockPlan.reason,
    maxRecordLocks: config.maxRecordLocks,
    batchShardCount: config.batchShardCount,
    seedRecordCount: lockPlan.summary.seedRecordCount,
    recordLockCount: lockPlan.summary.recordLocks,
    batchLockCount: lockPlan.summary.batchLocks,
    tableLockCount: lockPlan.summary.tableLocks,
    tableLockTableIds: lockPlan.summary.tableLockTableIds,
    recordLocks,
    batchLocks,
    tableLocks,
    statements,
  };
};
