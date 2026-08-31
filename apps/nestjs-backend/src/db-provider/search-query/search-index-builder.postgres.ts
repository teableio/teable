/* eslint-disable regexp/no-unused-capturing-group */
/* eslint-disable sonarjs/no-duplicate-string */
import { assertNever, CellValueType, FieldType } from '@teable/core';
import type { IFieldInstance } from '../../features/field/model/factory';

import { IndexBuilderAbstract } from '../index-query/index-abstract-builder';

interface IPgIndex {
  schemaname: string;
  tablename: string;
  indexname: string;
  indexdef: string;
}

const unSupportCellValueType = [CellValueType.Boolean];

/**
 * New `idx_trgm_*` indexes only cover singleLineText, longText, and string
 * formulas. Keep in sync with `isAllowedSubstringSearchIndexProjection` in
 * v2 SearchFieldTextShape.ts. Lookups reuse the inner `type`.
 */
const allowsSubstringTrgmIndex = (field: IFieldInstance): boolean => {
  if (field.isMultipleCellValue) {
    return false;
  }
  if (field.type === FieldType.Formula) {
    return field.cellValueType === CellValueType.String && !field.isStructuredCellValue;
  }
  return field.type === FieldType.SingleLineText || field.type === FieldType.LongText;
};

type ISearchIndexSpec =
  | {
      kind: 'btree';
      expression: string;
    }
  | {
      kind: 'trgm';
      expression: string;
    };

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
            return `"${dbFieldName}"::jsonb #>> '{title}'`;
          }
          if (field.type === FieldType.LongText) {
            // chr(13) is carriage return, chr(10) is line feed, chr(9) is tab
            return `REPLACE(REPLACE(REPLACE(value, CHR(13), ' '::text), CHR(10), ' '::text), CHR(9), ' '::text)`;
          } else {
            return `value`;
          }
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
  static getIndexSpec(field: IFieldInstance): ISearchIndexSpec | null {
    if (field.cellValueType === CellValueType.DateTime) {
      if (field.isMultipleCellValue) {
        return null;
      }

      return {
        kind: 'btree',
        expression: `"${field.dbFieldName}"`,
      };
    }

    if (!allowsSubstringTrgmIndex(field)) {
      return null;
    }

    const expression = this.getSearchableExpression(field, field.isMultipleCellValue);
    if (!expression) {
      return null;
    }

    return {
      kind: 'trgm',
      expression,
    };
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
    const indexSpec = FieldFormatter.getIndexSpec(field);
    if (indexSpec === null) {
      return null;
    }

    if (indexSpec.kind === 'btree') {
      return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${schema}"."${table}" USING btree (${indexSpec.expression})`;
    }

    return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${schema}"."${table}" USING gin ((${indexSpec.expression}) gin_trgm_ops)`;
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
        return this.createSingleIndexSql(dbTableName, field);
      })
      .filter((sql): sql is string => sql !== null);

    // Install shared extensions outside a space's internal schema. Scoped BYODB
    // transactions put that schema first on search_path, so omitting WITH SCHEMA
    // would make the first space own pg_trgm and hide its operator classes from
    // every other space using the same database.
    fieldSql.unshift(`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;`);
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
    const [schema, table] = dbTableName.split('.');
    const searchFactor = this.getSearchFactor();
    // Cast pg_catalog `name` columns to text: scoped data-db clients run raw
    // queries through @prisma/adapter-pg, which cannot deserialize `name`.
    return `
      SELECT schemaname::text, tablename::text, indexname::text, indexdef
      FROM pg_indexes
      WHERE schemaname = '${schema}'
      AND tablename = '${table}'
      AND indexname like '${searchFactor}%'`;
  }

  getAbnormalIndex(dbTableName: string, fields: IFieldInstance[], existingIndex: IPgIndex[]) {
    const [, table] = dbTableName.split('.');
    const expectExistIndex = fields
      .filter(({ cellValueType }) => !unSupportCellValueType.includes(cellValueType))
      .filter((field) => this.createSingleIndexSql(dbTableName, field) !== null)
      .map((field) => this.getIndexName(table, field));

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
      .flatMap((f) => {
        const indexDef = this.createSingleIndexSql(dbTableName, f);
        return indexDef
          ? [
              {
                indexName: this.getIndexName(table, f),
                indexDef,
              },
            ]
          : [];
      });

    return expectIndexDef
      .filter(({ indexDef }) => {
        const existIndex = existingIndex.map((idx) =>
          idx.indexdef
            .toLowerCase()
            .replace(/[()\s"']/g, '')
            .replace(/::(jsonb|text\[\]|text)/g, '')
        );
        return !existIndex.includes(
          indexDef
            .toLowerCase()
            .replace(/[()\s"']/g, '')
            .replace(/::(jsonb|text\[\]|text)/g, '')
            .replace(/ifnotexists/g, '')
        );
      })
      .map(({ indexName }) => ({
        indexName,
      }));
  }
}
