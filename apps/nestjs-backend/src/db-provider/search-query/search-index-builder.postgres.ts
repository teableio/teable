/* eslint-disable sonarjs/no-duplicate-string */
import { assertNever, CellValueType } from '@teable/core';
import type { IFieldInstance } from '../../features/field/model/factory';

import { IndexBuilderAbstract } from '../index-query/index-abstract-builder';

interface IPgIndex {
  schemaname: string;
  tablename: string;
  indexname: string;
  tablespace: string;
  indexdef: string;
}

const unSupportCellValueType = [CellValueType.DateTime, CellValueType.Boolean];

export class FieldFormatter {
  static getSearchableExpression(field: IFieldInstance, isArray = false): string | null {
    const { cellValueType, dbFieldName, options, isStructuredCellValue } = field;

    // base expression
    const baseExpression = (() => {
      switch (cellValueType) {
        case CellValueType.Number: {
          const precision =
            (options as { formatting?: { precision?: number } })?.formatting?.precision ?? 0;
          return `ROUND(value::numeric, ${precision})::text`;
        }
        case CellValueType.DateTime: {
          // date type not support full text search
          return null;
        }
        case CellValueType.Boolean: {
          // date type not support full text search
          return null;
        }
        case CellValueType.String: {
          if (isStructuredCellValue) {
            return `value->>'title'::text`;
          }
          return 'value';
        }
        default:
          assertNever(cellValueType);
      }
    })();

    if (baseExpression === null) {
      return null;
    }

    // handle array type
    // gin cannot handle any sub-query, so we need to use array_to_string to convert array to stringZ
    if (isArray) {
      return `"${dbFieldName}"::text`;
    }

    // handle single value type
    return baseExpression.replace(/value/g, `"${dbFieldName}"`);
  }

  // expression for generating index
  static getIndexExpression(field: IFieldInstance): string | null {
    return this.getSearchableExpression(field, field.isMultipleCellValue);
  }
}

export class IndexBuilderPostgres extends IndexBuilderAbstract {
  static PG_MAX_INDEX_LEN = 63;
  static DELIMITER_LEN = 3;

  private getIndexPrefix() {
    return `idx_trgm`;
  }

  private getIndexName(table: string, field: Pick<IFieldInstance, 'id' | 'dbFieldName'>): string {
    const { dbFieldName, id } = field;
    const prefix = this.getIndexPrefix();
    const maxTableDbNameLen =
      IndexBuilderPostgres.PG_MAX_INDEX_LEN -
      id.length -
      this.getIndexPrefix().length -
      IndexBuilderPostgres.DELIMITER_LEN;
    const tableDbNameLen = maxTableDbNameLen < table.length ? maxTableDbNameLen : table.length;
    // 3 is space character
    const dbFieldNameLen =
      maxTableDbNameLen < table.length
        ? 0
        : IndexBuilderPostgres.PG_MAX_INDEX_LEN -
          id.length -
          this.getIndexPrefix().length -
          tableDbNameLen -
          IndexBuilderPostgres.DELIMITER_LEN;
    const abbDbFieldName = dbFieldName.slice(0, dbFieldNameLen);
    return `${prefix}_${table.slice(0, tableDbNameLen)}_${abbDbFieldName}_${id}`;
  }

  private getSearchFactor() {
    return this.getIndexPrefix();
  }

  createSingleIndexSql(dbTableName: string, field: IFieldInstance): string | null {
    const [schema, table] = dbTableName.split('.');
    const indexName = this.getIndexName(table, field);
    const expression = FieldFormatter.getIndexExpression(field);
    if (expression === null) {
      return null;
    }

    return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${schema}"."${table}" USING gin ((${expression}) gin_trgm_ops)`;
  }

  getDropIndexSql(dbTableName: string): string {
    const [schema, table] = dbTableName.split('.');
    const searchFactor = this.getSearchFactor();
    return `
      DO $$ 
      DECLARE 
        _index record;
      BEGIN 
        FOR _index IN 
          SELECT indexname 
          FROM pg_indexes 
          WHERE schemaname = '${schema}' 
          AND tablename = '${table}'
          AND indexname LIKE '${searchFactor}%'
        LOOP
          EXECUTE 'DROP INDEX IF EXISTS "' || '${schema}' || '"."' || _index.indexname || '"';
        END LOOP;
      END $$;
    `;
  }

  getCreateIndexSql(dbTableName: string, searchFields: IFieldInstance[]): string[] {
    const fieldSql = searchFields
      .filter(({ cellValueType }) => !unSupportCellValueType.includes(cellValueType))
      .map((field) => {
        const expression = FieldFormatter.getIndexExpression(field);
        return expression ? this.createSingleIndexSql(dbTableName, field) : null;
      })
      .filter((sql): sql is string => sql !== null);

    fieldSql.unshift(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    return fieldSql;
  }

  getExistTableIndexSql(dbTableName: string): string {
    const [schema, table] = dbTableName.split('.');
    const searchFactor = this.getSearchFactor();
    return `
      SELECT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = '${schema}'
        AND tablename = '${table}'
        AND indexname LIKE '${searchFactor}%'
      )`;
  }

  getDeleteSingleIndexSql(dbTableName: string, field: IFieldInstance): string {
    const [schema, table] = dbTableName.split('.');
    const indexName = this.getIndexName(table, field);

    return `DROP INDEX IF EXISTS "${schema}"."${indexName}"`;
  }

  getUpdateSingleIndexNameSql(
    dbTableName: string,
    oldField: Pick<IFieldInstance, 'id' | 'dbFieldName'>,
    newField: Pick<IFieldInstance, 'id' | 'dbFieldName'>
  ): string {
    const [schema, table] = dbTableName.split('.');
    const oldIndexName = this.getIndexName(table, oldField);
    const newIndexName = this.getIndexName(table, newField);

    return `
      ALTER INDEX IF EXISTS "${schema}"."${oldIndexName}"
      RENAME TO "${newIndexName}"
    `;
  }

  getIndexInfoSql(dbTableName: string): string {
    const [, table] = dbTableName.split('.');
    const searchFactor = this.getSearchFactor();
    return `
    SELECT * FROM pg_indexes 
WHERE tablename = '${table}'
AND indexname like '${searchFactor}%'`;
  }

  getAbnormalIndex(dbTableName: string, fields: IFieldInstance[], existingIndex: IPgIndex[]) {
    const [, table] = dbTableName.split('.');
    const expectExistIndex = fields
      .filter(({ cellValueType }) => !unSupportCellValueType.includes(cellValueType))
      .map((field) => {
        return this.getIndexName(table, field);
      });

    // 1: find the lack or redundant index
    const lackingIndex = expectExistIndex.filter(
      (idxName) => !existingIndex.map((idx) => idx.indexname).includes(idxName)
    );
    const redundantIndex = existingIndex
      .map((idx) => idx.indexname)
      .filter((idxName) => !expectExistIndex.includes(idxName));

    const diffIndex = [...new Set([...redundantIndex, ...lackingIndex])];

    if (diffIndex.length) {
      return diffIndex.map((idxName) => ({ indexName: idxName }));
    }

    // 2: find the abnormal index definition
    const expectIndexDef = fields
      .filter(({ cellValueType }) => !unSupportCellValueType.includes(cellValueType))
      .map((f) => {
        return {
          indexName: this.getIndexName(table, f),
          indexDef: this.createSingleIndexSql(dbTableName, f) as string,
        };
      });

    return expectIndexDef
      .filter(({ indexDef }) => {
        const existIndex = existingIndex.map((idx) =>
          idx.indexdef.toLowerCase().replace(/[()\s"']/g, '')
        );
        return !existIndex.includes(
          indexDef
            .toLowerCase()
            .replace(/[()\s"']/g, '')
            .replace(/ifnotexists/g, '')
        );
      })
      .map(({ indexName }) => ({
        indexName,
      }));
  }
}
