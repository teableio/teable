import { CellValueType, DbFieldType, FieldType, Relationship } from '@teable/core';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import { vi } from 'vitest';
import { DuplicateTableQueryPostgres } from '../../db-provider/duplicate-table/duplicate-query.postgres';
import { TableDuplicateService } from './table-duplicate.service';

describe('TableDuplicateService.duplicateTableData', () => {
  it('skips target-only columns when copying rows', async () => {
    const dataKnex = Knex({ client: 'pg' });
    const executedSql: string[] = [];
    const sourceColumnSql = 'source-column-info';
    const targetColumnSql = 'target-column-info';
    const dataPrisma = {
      $queryRawUnsafe: vi.fn(async <T = unknown>(sql: string): Promise<T> => {
        if (sql === sourceColumnSql) {
          return [
            { name: '__id' },
            { name: '__version' },
            { name: '__auto_number' },
            { name: 'Name' },
            { name: 'Visible_Fields' },
          ] as T;
        }
        if (sql === targetColumnSql) {
          return [
            { name: '__id' },
            { name: '__version' },
            { name: '__auto_number' },
            { name: 'Name' },
            { name: 'Visible_Fields' },
            { name: 'AJ_Story_Fields' },
          ] as T;
        }
        if (sql.includes('count(*)')) {
          return [{ count: 1 }] as T;
        }
        return [] as T;
      }),
      $executeRawUnsafe: vi.fn(async (sql: string) => {
        executedSql.push(sql);
        return 1;
      }),
    };
    const fieldFindMany = vi.fn().mockResolvedValue([]);
    const service = Object.create(TableDuplicateService.prototype) as TableDuplicateService;

    (
      service as unknown as {
        prismaService: {
          txClient: () => {
            tableMeta: { findFirst: () => Promise<{ id: string }> };
            field: { findMany: typeof fieldFindMany };
          };
        };
        dbProvider: {
          columnInfo: (tableName: string) => string;
          duplicateTableQuery: (queryBuilder: KnexType.QueryBuilder) => DuplicateTableQueryPostgres;
        };
        dataKnex: KnexType;
      }
    ).prismaService = {
      txClient: () => ({
        tableMeta: { findFirst: async () => ({ id: 'tblTarget' }) },
        field: { findMany: fieldFindMany },
      }),
    };
    (
      service as unknown as {
        dbProvider: {
          columnInfo: (tableName: string) => string;
          duplicateTableQuery: (queryBuilder: KnexType.QueryBuilder) => DuplicateTableQueryPostgres;
        };
      }
    ).dbProvider = {
      columnInfo: (tableName: string) =>
        tableName === 'bseSource.SourceTable' ? sourceColumnSql : targetColumnSql,
      duplicateTableQuery: (queryBuilder) => new DuplicateTableQueryPostgres(queryBuilder),
    };
    (service as unknown as { dataKnex: KnexType }).dataKnex = dataKnex;
    (
      service as unknown as {
        audit: { emitAtomic: ReturnType<typeof vi.fn> };
        cls: Record<string, never>;
      }
    ).audit = {
      emitAtomic: vi.fn().mockResolvedValue(undefined),
    };
    (
      service as unknown as {
        cls: Record<string, never>;
      }
    ).cls = {};

    await service.duplicateTableData(
      'bseSource.SourceTable',
      'bseTarget.TargetTable',
      {},
      {},
      [],
      dataPrisma
    );

    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).toContain('"Name", "Visible_Fields"');
    expect(executedSql[0]).not.toContain('AJ_Story_Fields');

    await dataKnex.destroy();
  });
});

describe('TableDuplicateService.duplicateLinkJunction', () => {
  const createLinkFieldRaw = ({
    id,
    name,
    tableId,
    options,
  }: {
    id: string;
    name: string;
    tableId: string;
    options: Record<string, unknown>;
  }) =>
    ({
      id,
      name,
      tableId,
      options: JSON.stringify(options),
      type: FieldType.Link,
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
      dbFieldType: DbFieldType.Json,
      dbFieldName: name,
      description: null,
      notNull: null,
      unique: null,
      isPrimary: null,
      isComputed: null,
      isLookup: null,
      isPending: null,
      hasError: null,
      lookupLinkedFieldId: null,
      lookupOptions: null,
      version: 1,
      createdTime: new Date('2026-01-01T00:00:00.000Z'),
      lastModifiedTime: null,
      deletedTime: null,
      createdBy: 'usrTest',
      lastModifiedBy: null,
      order: 1,
      aiConfig: null,
      meta: null,
      isConditionalLookup: null,
      provisionState: 'ready',
    }) as never;

  it('copies one source junction into every distinct target junction host', async () => {
    const dataKnex = Knex({ client: 'pg' });
    const executedSql: string[] = [];
    const findMany = vi.fn();
    const sourceJunction = 'bseSource.junction_fldOwner_fldTasks';
    const targetOwnerJunction = 'bseTarget.junction_fldTargetOwner_fldTargetTasks';
    const targetTasksJunction = 'bseTarget.junction_fldTargetTasks_fldTargetOwner';

    findMany
      .mockResolvedValueOnce([
        createLinkFieldRaw({
          id: 'fldOwner',
          name: 'Owner',
          tableId: 'tblTasks',
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: 'tblPeople',
            fkHostTableName: sourceJunction,
            selfKeyName: '__fk_fldTasks',
            foreignKeyName: '__fk_fldOwner',
            symmetricFieldId: 'fldTasks',
          },
        }),
        createLinkFieldRaw({
          id: 'fldTasks',
          name: 'Tasks',
          tableId: 'tblPeople',
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: 'tblTasks',
            fkHostTableName: sourceJunction,
            selfKeyName: '__fk_fldOwner',
            foreignKeyName: '__fk_fldTasks',
            symmetricFieldId: 'fldOwner',
          },
        }),
      ])
      .mockResolvedValueOnce([
        createLinkFieldRaw({
          id: 'fldTargetOwner',
          name: 'Owner',
          tableId: 'tblTargetTasks',
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: 'tblTargetPeople',
            fkHostTableName: targetOwnerJunction,
            selfKeyName: '__fk_fldTargetTasks',
            foreignKeyName: '__fk_fldTargetOwner',
            symmetricFieldId: 'fldTargetTasks',
          },
        }),
        createLinkFieldRaw({
          id: 'fldTargetTasks',
          name: 'Tasks',
          tableId: 'tblTargetPeople',
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: 'tblTargetTasks',
            fkHostTableName: targetTasksJunction,
            selfKeyName: '__fk_fldTargetOwner',
            foreignKeyName: '__fk_fldTargetTasks',
            symmetricFieldId: 'fldTargetOwner',
          },
        }),
      ]);

    const service = Object.create(TableDuplicateService.prototype) as TableDuplicateService;
    (
      service as unknown as {
        prismaService: { txClient: () => { field: { findMany: typeof findMany } } };
        dataKnex: KnexType;
      }
    ).prismaService = {
      txClient: () => ({ field: { findMany } }),
    };
    (service as unknown as { dataKnex: KnexType }).dataKnex = dataKnex;

    await service.duplicateLinkJunction(
      { tblTasks: 'tblTargetTasks', tblPeople: 'tblTargetPeople' },
      { fldOwner: 'fldTargetOwner', fldTasks: 'fldTargetTasks' },
      true,
      {
        $executeRawUnsafe: vi.fn(async (sql: string) => {
          executedSql.push(sql);
          return 1;
        }),
        $queryRawUnsafe: vi.fn(),
      }
    );

    expect(executedSql).toHaveLength(2);
    expect(executedSql[0]).toContain('"bseTarget"."junction_fldTargetOwner_fldTargetTasks"');
    expect(executedSql[1]).toContain('"bseTarget"."junction_fldTargetTasks_fldTargetOwner"');

    await dataKnex.destroy();
  });
});
