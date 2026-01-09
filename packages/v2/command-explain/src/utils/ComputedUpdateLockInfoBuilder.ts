import type { Table } from '@teable/v2-core';
import {
  buildComputedUpdateLockPlan,
  defaultComputedUpdateLockConfig,
  type ComputedUpdateLockConfig,
  type ComputedUpdatePlan,
} from '@teable/v2-adapter-table-repository-postgres';

import type {
  ComputedUpdateLockInfo,
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
      seedRecordCount: 0,
      recordLockCount: 0,
      tableLockCount: 0,
      tableLockTableIds: [],
      recordLocks: [],
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
    key: statement.key,
    sql: statement.sql,
    parameters: statement.parameters,
  }));

  return {
    mode: lockPlan.summary.mode,
    reason: lockPlan.reason,
    maxRecordLocks: config.maxRecordLocks,
    seedRecordCount: lockPlan.summary.seedRecordCount,
    recordLockCount: lockPlan.summary.recordLocks,
    tableLockCount: lockPlan.summary.tableLocks,
    tableLockTableIds: lockPlan.summary.tableLockTableIds,
    recordLocks,
    tableLocks,
    statements,
  };
};
