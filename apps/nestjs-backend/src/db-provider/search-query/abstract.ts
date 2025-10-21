import type { TableIndex } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { IRecordQueryFilterContext } from '../../features/record/query-builder/record-query-builder.interface';
import type { ISearchQueryConstructor } from './types';

export abstract class SearchQueryAbstract {
  static appendQueryBuilder(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SearchQuery: ISearchQueryConstructor,
    originQueryBuilder: Knex.QueryBuilder,
    searchFields: IFieldInstance[],
    tableIndex: TableIndex[],
    search: [string, string?, boolean?],
    context?: IRecordQueryFilterContext
  ) {
    if (!search || !searchFields?.length) {
      return originQueryBuilder;
    }

    searchFields.forEach((fIns) => {
      const builder = new SearchQuery(originQueryBuilder, fIns, search, tableIndex, context);
      builder.appendBuilder();
    });

    return originQueryBuilder;
  }

  static buildSearchCountQuery(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SearchQuery: ISearchQueryConstructor,
    queryBuilder: Knex.QueryBuilder,
    searchField: IFieldInstance[],
    search: [string, string?, boolean?],
    tableIndex: TableIndex[],
    context?: IRecordQueryFilterContext
  ) {
    const searchQuery = searchField.map((field) => {
      const searchQueryBuilder = new SearchQuery(queryBuilder, field, search, tableIndex, context);
      return searchQueryBuilder.getSql();
    });

    const knexInstance = queryBuilder.client;

    queryBuilder.select(
      knexInstance.raw(`
        COALESCE(SUM(
          ${searchQuery.map((sql) => `(CASE WHEN (${sql}) THEN 1 ELSE 0 END)`).join(' + ')}
        ), 0) as count
      `)
    );

    return queryBuilder;
  }

  protected readonly fieldName: string;

  constructor(
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly field: IFieldInstance,
    protected readonly search: [string, string?, boolean?],
    protected readonly tableIndex: TableIndex[],
    protected readonly context?: IRecordQueryFilterContext
  ) {
    const { dbFieldName, id } = field;

    const selection = context?.selectionMap.get(id);
    if (selection !== undefined && selection !== null) {
      this.fieldName = this.normalizeSelection(selection) ?? this.quoteIdentifier(dbFieldName);
    } else {
      this.fieldName = this.quoteIdentifier(dbFieldName);
    }
  }

  protected abstract json(): Knex.QueryBuilder;

  protected abstract text(): Knex.QueryBuilder;

  protected abstract date(): Knex.QueryBuilder;

  protected abstract number(): Knex.QueryBuilder;

  protected abstract multipleNumber(): Knex.QueryBuilder;

  protected abstract multipleDate(): Knex.QueryBuilder;

  protected abstract multipleText(): Knex.QueryBuilder;

  protected abstract multipleJson(): Knex.QueryBuilder;

  abstract getSql(): string | null;

  abstract getQuery(): Knex.QueryBuilder;

  abstract appendBuilder(): Knex.QueryBuilder;

  private normalizeSelection(selection: unknown): string | undefined {
    if (typeof selection === 'string') {
      return selection;
    }
    if (selection && typeof (selection as Knex.Raw).toQuery === 'function') {
      return (selection as Knex.Raw).toQuery();
    }
    if (selection && typeof (selection as Knex.Raw).toSQL === 'function') {
      const { sql } = (selection as Knex.Raw).toSQL();
      if (sql) {
        return sql;
      }
    }
    return undefined;
  }

  private quoteIdentifier(identifier: string): string {
    if (!identifier) {
      return identifier;
    }
    if (identifier.startsWith('"') && identifier.endsWith('"')) {
      return identifier;
    }
    const escaped = identifier.replace(/"/g, '""');
    return `"${escaped}"`;
  }
}
