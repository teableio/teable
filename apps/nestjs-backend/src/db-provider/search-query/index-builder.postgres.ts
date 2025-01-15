/* eslint-disable sonarjs/no-duplicate-string */
import { CellValueType } from '@teable/core';
import type { IGetAbnormalVo } from '@teable/openapi';
import { difference } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import { IndexBuilderAbstract } from './index-builder.abstract';
import type { ISearchCellValueType } from './types';

interface IPgIndex {
  schemaname: string;
  tablename: string;
  indexname: string;
  tablespace: string;
  indexdef: string;
}

export class FieldFormatter {
  static getSearchableExpression(field: IFieldInstance, isArray = false): string | null {
    const { cellValueType, dbFieldName, options, isStructuredCellValue } = field;

    // base expression
    const baseExpression = (() => {
      switch (cellValueType as ISearchCellValueType) {
        case CellValueType.Number: {
          const precision =
            (options as { formatting?: { precision?: number } })?.formatting?.precision ?? 0;
          return `ROUND(value::numeric, ${precision})::text`;
        }
        case CellValueType.DateTime: {
          // date type not support full text search
          return null;
        }
        case CellValueType.String: {
          if (isStructuredCellValue) {
            return `value->>'title'`;
          }
          return 'value';
        }
        default:
          return 'value::text';
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
  private getIndexPrefix() {
    return `idx_trgm`;
  }

  private getIndexName(table: string, dbFieldName: string): string {
    const prefix = this.getIndexPrefix();
    return `${prefix}_${table}_${dbFieldName}`;
  }

  createSingleIndexSql(dbTableName: string, field: IFieldInstance): string | null {
    const [schema, table] = dbTableName.split('.');
    const indexName = this.getIndexName(table, field.dbFieldName);
    const expression = FieldFormatter.getIndexExpression(field);
    if (expression === null) {
      return null;
    }

    return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${schema}"."${table}" USING gin ((${expression}) gin_trgm_ops)`;
  }

  getDropIndexSql(dbTableName: string): string {
    const [schema, table] = dbTableName.split('.');
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
          AND indexname LIKE 'idx_trgm_${table}_%'
        LOOP
          EXECUTE 'DROP INDEX IF EXISTS "' || '${schema}' || '"."' || _index.indexname || '"';
        END LOOP;
      END $$;
    `;
  }

  getCreateIndexSql(dbTableName: string, searchFields: IFieldInstance[]): string[] {
    return searchFields
      .map((field) => {
        const expression = FieldFormatter.getIndexExpression(field);
        return expression ? this.createSingleIndexSql(dbTableName, field) : null;
      })
      .filter((sql): sql is string => sql !== null);
  }

  getExistTableIndexSql(dbTableName: string): string {
    const [schema, table] = dbTableName.split('.');
    return `
      SELECT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = '${schema}'
        AND tablename = '${table}'
        AND indexname LIKE 'idx_trgm_${table}%'
      )`;
  }

  getDeleteSingleIndexSql(dbTableName: string, dbFieldName: string): string {
    const [schema, table] = dbTableName.split('.');
    const indexName = this.getIndexName(table, dbFieldName);

    return `DROP INDEX IF EXISTS "${schema}"."${indexName}"`;
  }

  getUpdateSingleIndexNameSql(
    dbTableName: string,
    oldDbFieldName: string,
    newDbFieldName: string
  ): string {
    const [schema, table] = dbTableName.split('.');
    const oldIndexName = this.getIndexName(table, oldDbFieldName);
    const newIndexName = this.getIndexName(table, newDbFieldName);

    return `
      ALTER INDEX IF EXISTS "${schema}"."${oldIndexName}"
      RENAME TO "${newIndexName}"
    `;
  }

  getIndexInfoSql(dbTableName: string): string {
    const [, table] = dbTableName.split('.');
    const prefix = this.getIndexPrefix();
    return `
    SELECT * FROM pg_indexes 
WHERE tablename = '${table}'
AND indexname like '%${prefix}_${table}_%'`;
  }

  getAbnormalIndex(dbTableName: string, fields: IFieldInstance[], existingIndex: IPgIndex[]) {
    const [, table] = dbTableName.split('.');
    const expectExistIndex = fields
      .filter((f) => f.cellValueType !== CellValueType.DateTime)
      .map(({ dbFieldName }) => {
        return this.getIndexName(table, dbFieldName);
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
      .filter((f) => f.cellValueType !== CellValueType.DateTime)
      .map((f) => {
        return {
          indexName: this.getIndexName(dbTableName, f.dbFieldName),
          indexDef: this.createSingleIndexSql(dbTableName, f) as string,
        };
      });

    return expectIndexDef
      .filter(
        ({ indexDef }) =>
          !existingIndex
            .map((idx) => idx.indexdef.toLowerCase().replace(/[()\s]/g, ''))
            .includes(
              indexDef
                .toLowerCase()
                .replace(/if not exists/g, '')
                .replace(/[()\s]/g, '')
            )
      )
      .map(({ indexName }) => ({
        indexName,
      }));
  }
}
