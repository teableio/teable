import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  JoinType,
  type IAggregation,
  type IJoin,
  type ISqlQuery,
  type SqlQueryFieldType,
} from '@teable/openapi';
import { Knex } from 'knex';
import { cloneDeep, get } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { FieldService } from '../field/field.service';
import { createFieldInstanceByRaw, type IFieldInstance } from '../field/model/factory';

@Injectable()
export class SqlQueryService {
  constructor(
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    private readonly fieldService: FieldService,
    private readonly prismaService: PrismaService
  ) {}

  async sqlQuery(baseId: string, sqlQuery: ISqlQuery) {
    const { fieldMap, queryBuilder } = await this.parseSqlQuery(baseId, sqlQuery);
    const query = queryBuilder.toQuery();
    const records = await this.prismaService.$queryRawUnsafe(query);
    return {
      fieldMap,
      records,
    };
  }

  async parseSqlQuery(
    baseId: string,
    sqlQuery: ISqlQuery
  ): Promise<{
    fieldMap: Record<string, IFieldInstance>;
    queryBuilder: Knex.QueryBuilder;
  }> {
    console.log('parse sqlQuery', sqlQuery);
    if (typeof sqlQuery.from === 'string') {
      const dbTableName = await this.getDbTableName(baseId, sqlQuery.from);
      const fieldMap = await this.getFieldMap(sqlQuery.from);
      const queryBuilder = this.knex(dbTableName);
      // aggregation
      if (sqlQuery.aggregation) {
        return this.buildAggregationQuery(
          { ...sqlQuery, aggregation: sqlQuery.aggregation },
          { queryBuilder, fieldMap, baseId }
        );
      }
      return this.buildNormalQuery(sqlQuery, { queryBuilder, fieldMap, baseId });
    }
    const { queryBuilder, fieldMap } = await this.parseSqlQuery(baseId, sqlQuery.from);
    if (sqlQuery.aggregation) {
      return this.buildAggregationQuery(
        { ...sqlQuery, aggregation: sqlQuery.aggregation },
        { queryBuilder, fieldMap, baseId }
      );
    }
    const newQueryBuilder = this.knex(queryBuilder.as('sub_query'));
    return this.buildNormalQuery(sqlQuery, { queryBuilder: newQueryBuilder, fieldMap, baseId });
  }

  private async getDbTableName(baseId: string, tableId: string) {
    const tableMeta = await this.prismaService
      .txClient()
      .tableMeta.findUniqueOrThrow({
        where: { id: tableId, baseId },
        select: { dbTableName: true },
      })
      .catch(() => {
        throw new NotFoundException('Table not found');
      });
    return tableMeta.dbTableName;
  }

  async buildAggregationQuery(
    sqlQuery: ISqlQuery & { aggregation: IAggregation },
    {
      baseId,
      queryBuilder,
      fieldMap,
    }: {
      baseId: string;
      queryBuilder: Knex.QueryBuilder;
      fieldMap: Record<string, IFieldInstance>;
    }
  ) {
    if (sqlQuery.join) {
      for (const join of sqlQuery.join) {
        await this.joinQueryBuilder(join, {
          baseId,
          queryBuilder,
          fieldMap,
        });
      }
    }
    const fields: { id: string; type: SqlQueryFieldType }[] = sqlQuery.aggregation.map(
      (aggregation) => ({
        id: `${aggregation.field}_${aggregation.statisticFunc}`,
        type: 'context',
      })
    );

    const tableAlias = 't';
    const aggregationBuilder = this.knex()
      .with(tableAlias, (qb) => {
        qb.select('*').from(queryBuilder);
        if (sqlQuery.where) {
          this.dbProvider.filterQuery(qb, fieldMap, sqlQuery.where).appendQueryBuilder();
        }
        if (sqlQuery.orderBy) {
          this.dbProvider
            .sortQuery(
              qb,
              fieldMap,
              sqlQuery.orderBy.map((orderBy) => ({
                fieldId: orderBy.field,
                order: orderBy.order,
              }))
            )
            .appendSortBuilder();
        }
      })
      .from(tableAlias);
    this.dbProvider
      .aggregationQuery(
        aggregationBuilder,
        tableAlias,
        fieldMap,
        sqlQuery.aggregation.map((aggregation) => ({
          fieldId: aggregation.field,
          statisticFunc: aggregation.statisticFunc,
        })),
        {
          filter: sqlQuery.where,
          groupBy: sqlQuery.groupBy ? sqlQuery.groupBy.map((groupBy) => groupBy.field) : undefined,
        }
      )
      .appendBuilder();
    if (sqlQuery.orderBy) {
      aggregationBuilder.orderBy(
        sqlQuery.orderBy.map((orderBy) => ({
          column: `${tableAlias}.${orderBy.field}`,
          order: orderBy.order,
        }))
      );
    }
    const { limit = 100, offset = 0 } = sqlQuery;
    aggregationBuilder.offset(offset);
    aggregationBuilder.limit(limit);

    if (sqlQuery.groupBy) {
      sqlQuery.groupBy.forEach((groupBy) => {
        fields.push({
          id: groupBy.field,
          type: groupBy.type,
        });
      });
    }
    return {
      queryBuilder: aggregationBuilder,
      fieldMap: fields
        .map((field) => {
          if (field.type === 'context') {
            return this.createFieldInstanceByContext(field.id);
          } else {
            return fieldMap[field.id];
          }
        })
        .reduce(
          (acc, field) => {
            console.log('field', field, field.id);
            acc[field.id] = field;
            return acc;
          },
          {} as Record<string, IFieldInstance>
        ),
    };
  }

  async joinQueryBuilder(
    join: IJoin,
    context: {
      baseId: string;
      queryBuilder: Knex.QueryBuilder;
      fieldMap: Record<string, IFieldInstance>;
    }
  ) {
    const { queryBuilder, fieldMap, baseId } = context;
    const dbTableName =
      get(queryBuilder, ['_single', 'table', '_single', 'as']) ??
      get(queryBuilder, ['_single', 'table', '_single', 'table']);

    Object.values(fieldMap).forEach((field) => {
      field.dbFieldName = `${dbTableName}.${field.dbFieldName}`;
    });
    const joinDbTableName = await this.getDbTableName(baseId, join.table);
    const joinFieldMap = await this.getFieldMap(join.table);
    Object.values(joinFieldMap).forEach((field) => {
      field.dbFieldName = `${joinDbTableName}.${field.dbFieldName}`;
      fieldMap[field.id] = field;
    });
    const joinedField = fieldMap[join.on[0]];
    const joinField = fieldMap[join.on[1]];
    if (!joinedField || !joinField) {
      throw new BadRequestException('Invalid join field');
    }
    switch (join.type) {
      case JoinType.Inner:
        queryBuilder.innerJoin(
          joinDbTableName,
          joinedField.dbFieldName,
          '=',
          joinField.dbFieldName
        );
        break;
      case JoinType.Left:
        queryBuilder.leftJoin(joinDbTableName, joinedField.dbFieldName, '=', joinField.dbFieldName);
        break;
      case JoinType.Right:
        queryBuilder.rightJoin(
          joinDbTableName,
          joinedField.dbFieldName,
          '=',
          joinField.dbFieldName
        );
        break;
      case JoinType.Full:
        queryBuilder.fullOuterJoin(
          joinDbTableName,
          joinedField.dbFieldName,
          '=',
          joinField.dbFieldName
        );
        break;
      default:
        throw new BadRequestException('Invalid join type');
    }
  }

  async buildNormalQuery(
    sqlQuery: ISqlQuery,
    context: {
      baseId: string;
      queryBuilder: Knex.QueryBuilder;
      fieldMap: Record<string, IFieldInstance>;
    }
  ) {
    const { baseId, queryBuilder } = context;
    const fieldMap = cloneDeep(context.fieldMap);
    if (sqlQuery.join) {
      for (const join of sqlQuery.join) {
        await this.joinQueryBuilder(join, {
          baseId,
          queryBuilder,
          fieldMap,
        });
      }
    }
    if (sqlQuery.where) {
      this.dbProvider.filterQuery(queryBuilder, fieldMap, sqlQuery.where).appendQueryBuilder();
    }
    if (sqlQuery.orderBy) {
      this.dbProvider
        .sortQuery(
          queryBuilder,
          fieldMap,
          sqlQuery.orderBy.map((orderBy) => ({
            fieldId: orderBy.field,
            order: orderBy.order,
          }))
        )
        .appendSortBuilder();
    }
    if (sqlQuery.groupBy) {
      this.dbProvider
        .groupQuery(
          queryBuilder,
          fieldMap,
          sqlQuery.groupBy.map((groupBy) => groupBy.field)
        )
        .appendGroupBuilder();
      queryBuilder.select(sqlQuery.groupBy.map((groupBy) => fieldMap[groupBy.field].dbFieldName));
    }
    return {
      queryBuilder,
      fieldMap,
    };
  }

  async getFieldMap(tableId: string) {
    const fields = await this.fieldService.getFieldInstances(tableId, {});
    return fields.reduce(
      (acc, field) => {
        acc[field.id] = field;
        return acc;
      },
      {} as Record<string, IFieldInstance>
    );
  }

  createFieldInstanceByContext(id: string): IFieldInstance {
    return createFieldInstanceByRaw({
      id: id,
      dbFieldName: id,
      name: '',
      description: null,
      options: null,
      type: FieldType.Number,
      cellValueType: CellValueType.Number,
      isMultipleCellValue: null,
      dbFieldType: DbFieldType.Integer,
      notNull: null,
      unique: null,
      isPrimary: null,
      isComputed: null,
      isLookup: null,
      isPending: null,
      hasError: null,
      lookupLinkedFieldId: null,
      lookupOptions: null,
      tableId: '',
      order: 0,
      version: 0,
      lastModifiedTime: null,
      deletedTime: null,
      createdBy: '',
      lastModifiedBy: null,
      createdTime: new Date(),
    });
  }
}
