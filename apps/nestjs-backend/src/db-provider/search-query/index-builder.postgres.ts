/* eslint-disable sonarjs/no-duplicate-string */
import { CellValueType } from '@teable/core';
import type { IFieldInstance } from '../../features/field/model/factory';
import { IndexBuilderAbstract } from './index-builder.abstract';
import type { ISearchCellValueType } from './types';

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
          return 'value::text';
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
  private getIndexName(table: string, field: IFieldInstance): string {
    return `idx_trgm_${table}_${field.dbFieldName}`;
  }

  createOneIndexSql(dbTableName: string, field: IFieldInstance): string | null {
    const [schema, table] = dbTableName.split('.');
    const indexName = this.getIndexName(table, field);
    const expression = FieldFormatter.getIndexExpression(field);
    if (expression === null) {
      return null;
    }

    return `
      CREATE INDEX IF NOT EXISTS "${indexName}"
      ON "${schema}"."${table}"
      USING gin ((${expression}) gin_trgm_ops)
    `;
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
        return expression ? this.createOneIndexSql(dbTableName, field) : null;
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
}
