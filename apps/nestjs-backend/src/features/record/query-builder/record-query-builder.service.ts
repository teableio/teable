import { Inject, Injectable } from '@nestjs/common';
import type { IFilter, IFormulaConversionContext, ISortItem } from '@teable/core';
import type { IAggregationField } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { preservedDbFieldNames } from '../../field/constant';
import { FieldSelectVisitor } from '../../field/field-select-visitor';
import type { IFieldInstance } from '../../field/model/factory';
import { RecordQueryBuilderHelper } from './record-query-builder.helper';
import type {
  IRecordQueryBuilder,
  IRecordQueryParams,
  ILinkFieldCteContext,
  IRecordSelectionMap,
  ICreateRecordQueryBuilderOptions,
  ICreateRecordAggregateBuilderOptions,
} from './record-query-builder.interface';

/**
 * Service for building table record queries
 * This service encapsulates the logic for creating Knex query builders
 * with proper field selection using the visitor pattern
 */
@Injectable()
export class RecordQueryBuilderService implements IRecordQueryBuilder {
  private static readonly mainTableAlias = 'mt';

  constructor(
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @Inject('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly helper: RecordQueryBuilderHelper
  ) {}

  /**
   * Create a record [mainTableAlias]  query builder} with }select fields for the given table
   */
  async createRecordQueryBuilder(
    from: string,
    options: ICreateRecordQueryBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string }> {
    const { tableIdOrDbTableName, viewId, filter, sort, currentUserId } = options;
    const { tableId, dbTableName } = await this.helper.getTableInfo(tableIdOrDbTableName);
    const fields = await this.helper.getAllFields(tableId);
    const linkFieldCteContext = await this.helper.createLinkFieldContexts(
      fields,
      tableId,
      dbTableName
    );

    const params: IRecordQueryParams = {
      tableId,
      viewId,
      fields,
      from,
      linkFieldContexts: linkFieldCteContext.linkFieldContexts,
      filter,
      sort,
      currentUserId,
    };

    const qb = this.buildQueryWithParams(params, linkFieldCteContext);
    return { qb, alias: RecordQueryBuilderService.mainTableAlias };
  }

  /**
   * Create a record aggregate query builder for aggregation operations
   */
  async createRecordAggregateBuilder(
    from: string,
    options: ICreateRecordAggregateBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string }> {
    const { tableIdOrDbTableName, filter, aggregationFields, groupBy, currentUserId } = options;
    // Note: viewId is available in options but not used in current implementation
    // It could be used for view-based field filtering or permissions in the future
    const { tableId, dbTableName } = await this.helper.getTableInfo(tableIdOrDbTableName);
    const fields = await this.helper.getAllFields(tableId);
    const linkFieldCteContext = await this.helper.createLinkFieldContexts(
      fields,
      tableId,
      dbTableName
    );

    const queryBuilder = this.knex.from({ [RecordQueryBuilderService.mainTableAlias]: from });

    // For aggregation queries, we don't need Link field CTEs as they're not typically used in aggregations
    // This simplifies the query and improves performance
    const fieldMap = fields.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
      },
      {} as Record<string, IFieldInstance>
    );

    // Build aggregation query
    const qb = this.buildAggregateQuery(queryBuilder, {
      tableId,
      dbTableName,
      fields,
      fieldMap,
      filter,
      aggregationFields,
      groupBy,
      currentUserId,
      linkFieldCteContext,
    });

    return { qb, alias: RecordQueryBuilderService.mainTableAlias };
  }

  /**
   * Build query with detailed parameters
   */
  private buildQueryWithParams(
    params: IRecordQueryParams,
    linkFieldCteContext: ILinkFieldCteContext
  ): Knex.QueryBuilder {
    const { fields, linkFieldContexts, from, filter, sort, currentUserId } = params;
    const { mainTableName } = linkFieldCteContext;
    const mainTableAlias = RecordQueryBuilderService.mainTableAlias;

    const queryBuilder = this.knex.from({ [mainTableAlias]: from });

    // Build formula conversion context
    const context = this.helper.buildFormulaContext(fields);

    // Add field CTEs and their JOINs if Link field contexts are provided
    const { fieldCteMap, enhancedContext } = this.helper.addFieldCtesSync(
      queryBuilder,
      fields,
      mainTableName,
      mainTableAlias,
      linkFieldContexts,
      linkFieldCteContext.tableNameMap,
      linkFieldCteContext.additionalFields
    );

    // Build select fields using enhanced context that includes foreign table fields
    const selectionMap = this.buildSelect(
      queryBuilder,
      fields,
      enhancedContext.fieldMap.size > 0 ? enhancedContext : context,
      fieldCteMap,
      mainTableAlias
    );

    if (filter) {
      this.buildFilter(queryBuilder, fields, filter, selectionMap, currentUserId);
    }

    if (sort) {
      this.buildSort(queryBuilder, fields, sort, selectionMap);
    }

    return queryBuilder;
  }

  /**
   * Build select fields using visitor pattern
   */
  private buildSelect(
    qb: Knex.QueryBuilder,
    fields: IFieldInstance[],
    context: IFormulaConversionContext,
    fieldCteMap?: Map<string, string>,
    mainTableAlias?: string
  ): IRecordSelectionMap {
    const visitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      context,
      fieldCteMap,
      mainTableAlias
    );

    // Add default system fields with table alias
    if (mainTableAlias) {
      const systemFieldsWithAlias = Array.from(preservedDbFieldNames).map(
        (fieldName) => `${mainTableAlias}.${fieldName}`
      );
      qb.select(systemFieldsWithAlias);
    } else {
      qb.select(Array.from(preservedDbFieldNames));
    }

    // Add field-specific selections using visitor pattern
    for (const field of fields) {
      const result = field.accept(visitor);
      if (result) {
        qb.select(result);
      }
    }

    return visitor.getSelectionMap();
  }

  private buildFilter(
    qb: Knex.QueryBuilder,
    fields: IFieldInstance[],
    filter: IFilter,
    selectionMap: IRecordSelectionMap,
    currentUserId?: string
  ): this {
    const map = fields.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
      },
      {} as Record<string, IFieldInstance>
    );
    this.dbProvider
      .filterQuery(qb, map, filter, { withUserId: currentUserId }, { selectionMap })
      .appendQueryBuilder();
    return this;
  }

  private buildSort(
    qb: Knex.QueryBuilder,
    fields: IFieldInstance[],
    sortObjs: ISortItem[],
    selectionMap: IRecordSelectionMap
  ) {
    const map = fields.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
      },
      {} as Record<string, IFieldInstance>
    );
    const sortContext = { selectionMap };
    this.dbProvider.sortQuery(qb, map, sortObjs, undefined, sortContext).appendSortBuilder();
    return this;
  }

  private buildAggregateSelect(
    qb: Knex.QueryBuilder,
    fields: IFieldInstance[],
    context: IFormulaConversionContext,
    fieldCteMap?: Map<string, string>
  ) {
    const visitor = new FieldSelectVisitor(qb, this.dbProvider, context, fieldCteMap);

    // Add field-specific selections using visitor pattern
    for (const field of fields) {
      field.accept(visitor);
    }

    return visitor.getSelectionMap();
  }

  /**
   * Build aggregate query with special handling for aggregation operations
   */
  private buildAggregateQuery(
    queryBuilder: Knex.QueryBuilder,
    params: {
      tableId: string;
      dbTableName: string;
      fields: IFieldInstance[];
      fieldMap: Record<string, IFieldInstance>;
      filter?: IFilter;
      aggregationFields: IAggregationField[];
      groupBy?: string[];
      currentUserId?: string;
      linkFieldCteContext: ILinkFieldCteContext;
    }
  ): Knex.QueryBuilder {
    const {
      dbTableName,
      fields,
      fieldMap,
      filter,
      aggregationFields,
      groupBy,
      currentUserId,
      linkFieldCteContext,
    } = params;

    const { mainTableName } = linkFieldCteContext;

    // Build formula conversion context
    const context = this.helper.buildFormulaContext(fields);

    // Add field CTEs and their JOINs if Link field contexts are provided
    const { fieldCteMap } = this.helper.addFieldCtesSync(
      queryBuilder,
      fields,
      mainTableName,
      RecordQueryBuilderService.mainTableAlias,
      linkFieldCteContext.linkFieldContexts,
      linkFieldCteContext.tableNameMap,
      linkFieldCteContext.additionalFields
    );

    const selectionMap = this.buildAggregateSelect(queryBuilder, fields, context, fieldCteMap);

    // Build select fields
    // Apply filter if provided
    if (filter) {
      this.buildFilter(queryBuilder, fields, filter, selectionMap, currentUserId);
    }

    // Apply aggregation
    this.dbProvider
      .aggregationQuery(queryBuilder, dbTableName, fieldMap, aggregationFields)
      .appendBuilder();

    // Apply grouping if specified
    if (groupBy && groupBy.length > 0) {
      this.dbProvider
        .groupQuery(queryBuilder, fieldMap, groupBy, undefined, { selectionMap })
        .appendGroupBuilder();
    }

    return queryBuilder;
  }
}
