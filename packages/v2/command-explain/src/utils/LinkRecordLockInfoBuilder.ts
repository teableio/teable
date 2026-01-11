import type { Table } from '@teable/v2-core';
import type { LinkedRecordLockInfo } from '@teable/v2-adapter-table-repository-postgres';

import type { LinkRecordLocksInfo, LinkRecordLockInfo as LinkRecordLockInfoType } from '../types';

/**
 * Build the lock key for a linked record.
 */
const buildLinkRecordLockKey = (
  baseId: string,
  foreignTableId: string,
  foreignRecordId: string
): string => `v2:link:${baseId}:${foreignTableId}:${foreignRecordId}`;

/**
 * Build the SQL statement for acquiring link record locks.
 */
const buildLinkRecordLockSql = (keys: string[]): { sql: string; parameters: string[] } => {
  if (keys.length === 0) {
    return { sql: '', parameters: [] };
  }

  const arrayLiteral = `ARRAY[${keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')}]`;
  const sql = `SELECT pg_advisory_xact_lock(('x' || substr(md5(k), 1, 16))::bit(64)::bigint)
        FROM unnest(${arrayLiteral}::text[]) AS k
        ORDER BY k`;

  return { sql, parameters: [] };
};

export const buildLinkRecordLocksInfo = (params: {
  baseId: string;
  linkedRecordLocks: ReadonlyArray<LinkedRecordLockInfo>;
  tableById: Map<string, Table>;
}): LinkRecordLocksInfo => {
  const { baseId, linkedRecordLocks, tableById } = params;

  if (linkedRecordLocks.length === 0) {
    return {
      mode: 'none',
      reason: 'no link field values to lock',
      lockCount: 0,
      locks: [],
    };
  }

  const getTableName = (tableId: string): string => {
    const table = tableById.get(tableId);
    return table ? table.name().toString() : tableId;
  };

  // Deduplicate locks
  const lockMap = new Map<string, LinkRecordLockInfoType>();
  for (const lock of linkedRecordLocks) {
    const key = buildLinkRecordLockKey(baseId, lock.foreignTableId, lock.foreignRecordId);
    if (!lockMap.has(key)) {
      lockMap.set(key, {
        foreignTableId: lock.foreignTableId,
        foreignTableName: getTableName(lock.foreignTableId),
        foreignRecordId: lock.foreignRecordId,
        key,
      });
    }
  }

  const locks = [...lockMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const keys = locks.map((l) => l.key);
  const { sql, parameters } = buildLinkRecordLockSql(keys);

  return {
    mode: 'active',
    reason: `lock ${locks.length} foreign record(s) to prevent deadlocks during junction table operations`,
    lockCount: locks.length,
    locks,
    sql,
    parameters,
  };
};
