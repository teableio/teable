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
    const knexInstance = queryBuilder.client;

    const conditions = searchField
      .map((field) => {
        const searchQueryBuilder = new SearchQuery(
          queryBuilder,
          field,
          search,
          tableIndex,
          context
        );
        return searchQueryBuilder.getQuery();
      })
      .filter((cond): cond is Knex.Raw => Boolean(cond));

    if (conditions.length === 0) {
      queryBuilder.select(knexInstance.raw('0 as count'));
      return queryBuilder;
    }

    const parts = conditions.map((cond) =>
      knexInstance.raw('(CASE WHEN (?) THEN 1 ELSE 0 END)', [cond])
    );

    // Use nested raws to preserve bindings and avoid inlining values into SQL text.
    queryBuilder.select(
      knexInstance.raw(`COALESCE(SUM(${parts.map(() => '(?)').join(' + ')}), 0) as count`, parts)
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

  protected abstract json(): Knex.Raw;

  protected abstract text(): Knex.Raw;

  protected abstract date(): Knex.Raw;

  protected abstract number(): Knex.Raw;

  protected abstract multipleNumber(): Knex.Raw;

  protected abstract multipleDate(): Knex.Raw;

  protected abstract multipleText(): Knex.Raw;

  protected abstract multipleJson(): Knex.Raw;

  abstract getSql(): string | null;

  abstract getQuery(): Knex.Raw | null;

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
