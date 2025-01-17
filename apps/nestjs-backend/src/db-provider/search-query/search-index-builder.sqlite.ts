/* eslint-disable @typescript-eslint/no-unused-vars */
import { CellValueType } from '@teable/core';
import type { IGetAbnormalVo } from '@teable/openapi';
import type { IFieldInstance } from '../../features/field/model/factory';
import { IndexBuilderAbstract } from '../index-query/index-abstract-builder';
import type { ISearchCellValueType } from './types';

type ISqliteIndex = Record<string, unknown>;

export class FieldFormatter {
  static getSearchableExpression(field: IFieldInstance, isArray = false): string {
    const { cellValueType, dbFieldName, options, isStructuredCellValue } = field;

    // base expression
    const baseExpression = (() => {
      switch (cellValueType as ISearchCellValueType) {
        case CellValueType.Number: {
          const precision =
            (options as { formatting?: { precision?: number } })?.formatting?.precision ?? 0;
          return `ROUND(CAST(value AS REAL), ${precision})`;
        }
        case CellValueType.DateTime: {
          // SQLite doesn't support timezone conversion directly
          // We'll format the date in a basic format
          return `strftime('%Y-%m-%d %H:%M', value)`;
        }
        case CellValueType.String: {
          if (isStructuredCellValue) {
            return `json_extract(value, '$.title')`;
          }
          return 'CAST(value AS TEXT)';
        }
        default:
          return 'CAST(value AS TEXT)';
      }
    })();

    // handle array type
    if (isArray) {
      return `(
        WITH RECURSIVE split(word, str) AS (
          SELECT '', json_extract(${dbFieldName}, '$') || ','
          UNION ALL
          SELECT
            substr(str, 0, instr(str, ',')),
            substr(str, instr(str, ',') + 1)
          FROM split WHERE str != ''
        )
        SELECT group_concat(${baseExpression.replace(/value/g, 'word')}, ', ')
        FROM split WHERE word != ''
      )`;
    }

    // handle single value type
    return baseExpression.replace(/value/g, dbFieldName);
  }

  // expression for generating index
  static getIndexExpression(field: IFieldInstance): string {
    return this.getSearchableExpression(field, field.isMultipleCellValue);
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const NO_OPERATION_SQL = '/* no operation */';

export class IndexBuilderSqlite extends IndexBuilderAbstract {
  private getIndexName(table: string, dbFieldName: string): string {
    return `idx_trgm_${table}_${dbFieldName}`;
  }

  createSingleIndexSql(dbTableName: string, field: IFieldInstance): string {
    return NO_OPERATION_SQL;
  }

  getDropIndexSql(dbTableName: string): string {
    return `SELECT 'DROP TABLE IF EXISTS "' || name || '";'
      FROM sqlite_master 
      WHERE type='table' 
      AND name LIKE 'idx_fts_${dbTableName}_%'`;
  }

  getCreateIndexSql(dbTableName: string, searchFields: IFieldInstance[]): string[] {
    return searchFields.map((field) => this.createSingleIndexSql(dbTableName, field));
  }

  getExistTableIndexSql(dbTableName: string): string {
    return `SELECT EXISTS (
      SELECT 1 
      FROM sqlite_master 
      WHERE type='table' 
      AND name LIKE 'idx_fts_${dbTableName}_%'
    )`;
  }

  getDeleteSingleIndexSql(dbTableName: string, field: IFieldInstance): string {
    return NO_OPERATION_SQL;
  }

  getUpdateSingleIndexNameSql(
    dbTableName: string,
    oldField: IFieldInstance,
    newField: IFieldInstance
  ): string {
    return NO_OPERATION_SQL;
  }

  getIndexInfoSql(dbTableName: string): string {
    return NO_OPERATION_SQL;
  }

  getAbnormalIndex(dbTableName: string, fields: IFieldInstance[], existingIndex: ISqliteIndex[]) {
    return [] as IGetAbnormalVo;
  }
}
