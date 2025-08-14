import { Injectable } from '@nestjs/common';
import type { IFilter, IFormulaConversionContext, ISortItem } from '@teable/core';
import type { IAggregationField } from '@teable/openapi';
import type { Knex } from 'knex';
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
  constructor(
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    private readonly helper: RecordQueryBuilderHelper
  ) {}

  /**
   * Create a record query builder with select fields for the given table
   */
  async createRecordQueryBuilder(
    queryBuilder: Knex.QueryBuilder,
    options: ICreateRecordQueryBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder }> {
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
      queryBuilder,
      linkFieldContexts: linkFieldCteContext.linkFieldContexts,
      filter,
      sort,
      currentUserId,
    };

    const qb = this.buildQueryWithParams(params, linkFieldCteContext);
    return { qb };
  }

  /**
   * Create a record aggregate query builder for aggregation operations
   */
  async createRecordAggregateBuilder(
    queryBuilder: Knex.QueryBuilder,
    options: ICreateRecordAggregateBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder }> {
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

    return { qb };
  }

  /**
   * Build query with detailed parameters
   */
  private buildQueryWithParams(
    params: IRecordQueryParams,
    linkFieldCteContext: ILinkFieldCteContext
  ): Knex.QueryBuilder {
    const { fields, queryBuilder, linkFieldContexts, filter, sort, currentUserId } = params;
    const { mainTableName } = linkFieldCteContext;

    // Build formula conversion context
    const context = this.helper.buildFormulaContext(fields);

    // Add field CTEs and their JOINs if Link field contexts are provided
    const fieldCteMap = this.helper.addFieldCtesSync(
      queryBuilder,
      fields,
      mainTableName,
      linkFieldContexts,
      linkFieldCteContext.tableNameMap,
      linkFieldCteContext.additionalFields
    );

    // Build select fields
    const selectionMap = this.buildSelect(queryBuilder, fields, context, fieldCteMap);

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
    fieldCteMap?: Map<string, string>
  ): IRecordSelectionMap {
    const visitor = new FieldSelectVisitor(qb, this.dbProvider, context, fieldCteMap);

    // Add default system fields
    qb.select(Array.from(preservedDbFieldNames));

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
    aggregationFields: IAggregationField[],
    fieldCteMap?: Map<string, string>
  ) {
    const visitor = new FieldSelectVisitor(qb, this.dbProvider, context, fieldCteMap);

    // Add field-specific selections using visitor pattern
    for (const field of fields) {
      const result = field.accept(visitor);
      if (result && aggregationFields.some((v) => v.fieldId === field.id)) {
        qb.select(result);
      }
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
    const fieldCteMap = this.helper.addFieldCtesSync(
      queryBuilder,
      fields,
      mainTableName,
      linkFieldCteContext.linkFieldContexts,
      linkFieldCteContext.tableNameMap,
      linkFieldCteContext.additionalFields
    );

    const selectionMap = this.buildAggregateSelect(
      queryBuilder,
      fields,
      context,
      aggregationFields,
      fieldCteMap
    );

    // Build select fields
    // Apply filter if provided
    if (filter) {
      this.buildFilter(queryBuilder, fields, filter, selectionMap, currentUserId);
    }

    // Apply aggregation
    this.dbProvider
      .aggregationQuery(queryBuilder, dbTableName, fieldMap, aggregationFields, { groupBy })
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
