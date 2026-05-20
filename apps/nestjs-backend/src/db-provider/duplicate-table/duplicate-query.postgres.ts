import type { Knex } from 'knex';
import { DuplicateTableQueryAbstract } from './abstract';

export class DuplicateTableQueryPostgres extends DuplicateTableQueryAbstract {
  protected knex: Knex.Client;
  constructor(queryBuilder: Knex.QueryBuilder) {
    super(queryBuilder);
    this.knex = queryBuilder.client;
  }

  duplicateTableData(
    sourceTable: string,
    targetTable: string,
    newColumns: string[],
    oldColumns: string[],
    crossBaseLinkDbFieldNames: { dbFieldName: string; isMultipleCellValue: boolean }[],
    range?: {
      minAutoNumberExclusive?: number;
      maxAutoNumberInclusive?: number;
    }
  ) {
    const newColumnList = newColumns.map((col) => `"${col}"`).join(', ');
    const oldColumnList = oldColumns
      .map((col) => {
        if (col === '__version') {
          return '1 AS "__version"';
        }
        // cross base link field should transform to text from json
        if (crossBaseLinkDbFieldNames.map(({ dbFieldName }) => dbFieldName).includes(col)) {
          const isMultipleCellValue = crossBaseLinkDbFieldNames.find(
            ({ dbFieldName }) => dbFieldName === col
          )?.isMultipleCellValue;
          return !isMultipleCellValue
            ? `"${col}" ->> 'title' as "${col}"`
            : `CASE
           WHEN "${col}" IS NULL THEN NULL
           ELSE (SELECT string_agg(elem ->> 'title', ', ')
                 FROM json_array_elements(CAST("${col}" AS json)) AS elem)
           END as "${col}"`;
        }
        return `"${col}"`;
      })
      .join(', ');
    const whereClauses: string[] = [];
    const whereBindings: unknown[] = [];
    if (range?.minAutoNumberExclusive != null) {
      whereClauses.push('"__auto_number" > ?');
      whereBindings.push(range.minAutoNumberExclusive);
    }
    if (range?.maxAutoNumberInclusive != null) {
      whereClauses.push('"__auto_number" <= ?');
      whereBindings.push(range.maxAutoNumberInclusive);
    }
    const whereSql = whereClauses.length ? ` WHERE ${whereClauses.join(' AND ')}` : '';
    return this.knex.raw(
      `INSERT INTO ?? (${newColumnList}) SELECT ${oldColumnList} FROM ??${whereSql} ORDER BY "__auto_number"`,
      [targetTable, sourceTable, ...whereBindings]
    );
  }
}
