import { FieldType, Relationship, DbFieldType, CellValueType } from '@teable/core';
import { LinkFieldCore } from '@teable/core';
import { plainToInstance } from 'class-transformer';
import type { Knex } from 'knex';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IDropDatabaseColumnContext } from './drop-database-column-field-visitor.interface';
import { DropPostgresDatabaseColumnFieldVisitor } from './drop-database-column-field-visitor.postgres';
import { DropSqliteDatabaseColumnFieldVisitor } from './drop-database-column-field-visitor.sqlite';

describe('Drop Database Column Field Visitor', () => {
  let mockKnex: any;
  let context: IDropDatabaseColumnContext;

  beforeEach(() => {
    mockKnex = {
      schema: {
        dropTableIfExists: vi.fn().mockReturnValue({
          toSQL: vi.fn().mockReturnValue([{ sql: 'DROP TABLE IF EXISTS junction_table' }]),
        }),
      },
      raw: vi.fn().mockReturnValue({
        toQuery: vi.fn().mockReturnValue('DROP INDEX IF EXISTS index_column'),
      }),
    };

    context = {
      tableName: 'test_table',
      knex: mockKnex as Knex,
      linkContext: {
        tableId: 'table1',
        tableNameMap: new Map([['foreign_table_id', 'foreign_table']]),
      },
    };
  });

  describe('PostgreSQL Visitor', () => {
    it('should drop junction table for ManyMany relationship', () => {
      const visitor = new DropPostgresDatabaseColumnFieldVisitor(context);

      const linkField = plainToInstance(LinkFieldCore, {
        id: 'field1',
        name: 'Link Field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          fkHostTableName: 'junction_table',
          selfKeyName: 'self_key',
          foreignKeyName: 'foreign_key',
          isOneWay: false,
          foreignTableId: 'foreign_table_id',
          lookupFieldId: 'lookup_field_id',
        },
        dbFieldName: 'link_field',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
      });

      const queries = visitor.visitLinkField(linkField);

      expect(queries).toContain('DROP TABLE IF EXISTS junction_table');
    });

    it('should drop foreign key column for ManyOne relationship', () => {
      const visitor = new DropPostgresDatabaseColumnFieldVisitor(context);

      const linkField = plainToInstance(LinkFieldCore, {
        id: 'field1',
        name: 'Link Field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          fkHostTableName: 'target_table',
          selfKeyName: 'self_key',
          foreignKeyName: 'foreign_key',
          isOneWay: false,
          foreignTableId: 'foreign_table_id',
          lookupFieldId: 'lookup_field_id',
        },
        dbFieldName: 'link_field',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: false,
      });

      const queries = visitor.visitLinkField(linkField);

      expect(queries.length).toBeGreaterThan(0);
      expect(mockKnex.raw).toHaveBeenCalledWith('DROP INDEX IF EXISTS ??', ['index_foreign_key']);
    });
  });

  describe('SQLite Visitor', () => {
    it('should drop junction table for ManyMany relationship', () => {
      const visitor = new DropSqliteDatabaseColumnFieldVisitor(context);

      const linkField = plainToInstance(LinkFieldCore, {
        id: 'field1',
        name: 'Link Field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          fkHostTableName: 'junction_table',
          selfKeyName: 'self_key',
          foreignKeyName: 'foreign_key',
          isOneWay: false,
          foreignTableId: 'foreign_table_id',
          lookupFieldId: 'lookup_field_id',
        },
        dbFieldName: 'link_field',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
      });

      const queries = visitor.visitLinkField(linkField);

      expect(queries).toContain('DROP INDEX IF EXISTS index_column');
    });
  });
});
