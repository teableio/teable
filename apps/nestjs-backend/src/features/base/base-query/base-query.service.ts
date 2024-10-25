import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { IAttachmentCellValue } from '@teable/core';
import { CellFormat, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { BaseQueryColumnType, BaseQueryJoinType } from '@teable/openapi';
import type { IBaseQueryJoin, IBaseQuery, IBaseQueryVo, IBaseQueryColumn } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import type { IClsStore } from '../../../types/cls';
import { FieldService } from '../../field/field.service';
import {
  convertFieldInstanceToFieldVo,
  createFieldInstanceByVo,
  type IFieldInstance,
} from '../../field/model/factory';
import { RecordService } from '../../record/record.service';
import { QueryAggregation } from './parse/aggregation';
import { QueryFilter } from './parse/filter';
import { QueryGroup } from './parse/group';
import { QueryOrder } from './parse/order';
import { QuerySelect } from './parse/select';
import { getQueryColumnTypeByFieldInstance } from './parse/utils';

@Injectable()
export class BaseQueryService {
  private logger = new Logger(BaseQueryService.name);

  constructor(
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,

    private readonly fieldService: FieldService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly recordService: RecordService
  ) {}

  private convertFieldMapToColumn(fieldMap: Record<string, IFieldInstance>): IBaseQueryColumn[] {
    return Object.values(fieldMap).map((field) => {
      const type = getQueryColumnTypeByFieldInstance(field);

      return {
        column: type === BaseQueryColumnType.Field ? field.dbFieldName : field.id,
        name: field.name,
        type,
        fieldSource:
          type === BaseQueryColumnType.Field ? convertFieldInstanceToFieldVo(field) : undefined,
      };
    });
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async dbRows2Rows(
    rows: Record<string, unknown>[],
    columns: IBaseQueryColumn[],
    cellFormat: CellFormat
  ) {
    const resRows: Record<string, unknown>[] = [];
    for (const row of rows) {
      const resRow: Record<string, unknown> = {};
      for (const field of columns) {
        if (!field.fieldSource) {
          const value = row[field.column];
          resRow[field.column] = row[field.column];
          // handle bigint
          if (typeof value === 'bigint') {
            resRow[field.column] = Number(value);
          } else {
            resRow[field.column] = value;
          }
          continue;
        }
        const dbCellValue = row[field.column];
        const fieldInstance = createFieldInstanceByVo(field.fieldSource);
        const cellValue = fieldInstance.convertDBValue2CellValue(dbCellValue);

        // number no need to convert string
        if (typeof cellValue === 'number') {
          resRow[field.column] = cellValue;
          continue;
        }
        if (cellValue != null) {
          resRow[field.column] =
            cellFormat === CellFormat.Text ? fieldInstance.cellValue2String(cellValue) : cellValue;
        }
        if (fieldInstance.type === FieldType.Attachment) {
          resRow[field.column] = await this.recordService.getAttachmentPresignedCellValue(
            cellValue as IAttachmentCellValue
          );
        }
      }
      resRows.push(resRow);
    }
    return resRows;
  }

  async baseQuery(
    baseId: string,
    baseQuery: IBaseQuery,
    cellFormat: CellFormat = CellFormat.Json
  ): Promise<IBaseQueryVo> {
    const { queryBuilder, fieldMap } = await this.parseBaseQuery(baseId, baseQuery, 0);
    const query = queryBuilder.toQuery();
    this.logger.log('baseQuery SQL: ', query);
    const rows = await this.prismaService
      .$queryRawUnsafe<{ [key in string]: unknown }[]>(query)
      .catch((e) => {
        this.logger.error(e);
        throw new BadRequestException(`Query failed: ${query}, ${e.message}`);
      });
    const columns = this.convertFieldMapToColumn(fieldMap);
    return {
      rows: await this.dbRows2Rows(rows, columns, cellFormat),
      columns,
    };
  }

  async parseBaseQuery(
    baseId: string,
    baseQuery: IBaseQuery,
    depth: number = 0
  ): Promise<{ queryBuilder: Knex.QueryBuilder; fieldMap: Record<string, IFieldInstance> }> {
    if (typeof baseQuery.from === 'string') {
      const dbTableName = await this.getDbTableName(baseId, baseQuery.from);
      const queryBuilder = this.knex(dbTableName);
      const fieldMap = await this.getFieldMap(baseQuery.from, dbTableName);
      return this.parseBaseQueryFromTable(baseQuery, {
        fieldMap,
        queryBuilder,
        baseId,
        dbTableName,
      });
    }
    const { queryBuilder, fieldMap } = await this.parseBaseQuery(baseId, baseQuery.from, depth + 1);
    const alias = 'source_query';
    return this.parseBaseQueryFromTable(baseQuery, {
      fieldMap: Object.keys(fieldMap).reduce(
        (acc, key) => {
          acc[key] = createFieldInstanceByVo({
            ...fieldMap[key],
            dbFieldName: `${alias}.${fieldMap[key].dbFieldName}`,
          });
          return acc;
        },
        {} as Record<string, IFieldInstance>
      ),
      queryBuilder: this.knex(queryBuilder.as(alias)),
      baseId,
      dbTableName: alias,
    });
  }

  async parseBaseQueryFromTable(
    baseQuery: IBaseQuery,
    context: {
      baseId: string;
      fieldMap: Record<string, IFieldInstance>;
      queryBuilder: Knex.QueryBuilder;
      dbTableName: string;
    }
  ): Promise<{ queryBuilder: Knex.QueryBuilder; fieldMap: Record<string, IFieldInstance> }> {
    const { fieldMap, baseId, queryBuilder, dbTableName } = context;
    let currentQueryBuilder = queryBuilder;
    let currentFieldMap = fieldMap;
    if (baseQuery.join) {
      const { queryBuilder: joinedQueryBuilder, fieldMap: joinedFieldMap } = await this.joinTable(
        baseQuery.join,
        { baseId, fieldMap, queryBuilder }
      );
      currentQueryBuilder = joinedQueryBuilder;
      currentFieldMap = joinedFieldMap;
    }

    const { fieldMap: filteredFieldMap, queryBuilder: filteredQueryBuilder } =
      new QueryFilter().parse(baseQuery.where, {
        dbProvider: this.dbProvider,
        queryBuilder: currentQueryBuilder,
        fieldMap: currentFieldMap,
        currentUserId: this.cls.get('user.id'),
      });
    currentFieldMap = filteredFieldMap;
    currentQueryBuilder = filteredQueryBuilder;

    const { queryBuilder: groupedQueryBuilder, fieldMap: groupedFieldMap } = new QueryGroup().parse(
      baseQuery.groupBy,
      {
        dbProvider: this.dbProvider,
        queryBuilder: currentQueryBuilder,
        fieldMap: currentFieldMap,
      }
    );
    currentFieldMap = groupedFieldMap;
    currentQueryBuilder = groupedQueryBuilder;

    // max limit 1000
    currentQueryBuilder.limit(
      baseQuery.limit && baseQuery.limit > 0 ? Math.min(baseQuery.limit, 1000) : 1000
    );

    if (baseQuery.offset) {
      currentQueryBuilder.offset(baseQuery.offset);
    }
    // clear select before aggregation and clear select in group by
    queryBuilder.clear('select');
    const { queryBuilder: aggregatedQueryBuilder, fieldMap: aggregatedFieldMap } =
      new QueryAggregation().parse(baseQuery.aggregation, {
        queryBuilder: currentQueryBuilder,
        fieldMap: currentFieldMap,
        dbTableName,
        dbProvider: this.dbProvider,
      });
    currentFieldMap = aggregatedFieldMap;
    currentQueryBuilder = aggregatedQueryBuilder;

    const { queryBuilder: orderedQueryBuilder, fieldMap: orderedFieldMap } = new QueryOrder().parse(
      baseQuery.orderBy,
      {
        dbProvider: this.dbProvider,
        queryBuilder: currentQueryBuilder,
        fieldMap: currentFieldMap,
      }
    );
    currentFieldMap = orderedFieldMap;
    currentQueryBuilder = orderedQueryBuilder;

    const { queryBuilder: selectedQueryBuilder, fieldMap: selectedFieldMap } =
      new QuerySelect().parse(baseQuery.select, {
        queryBuilder: currentQueryBuilder,
        fieldMap: currentFieldMap,
        // column must appear in the GROUP BY clause or be used in an aggregate function
        aggregation: baseQuery.aggregation,
        groupBy: baseQuery.groupBy,
        knex: this.knex,
        dbProvider: this.dbProvider,
      });

    return { queryBuilder: selectedQueryBuilder, fieldMap: selectedFieldMap };
  }

  async joinTable(
    joins: IBaseQueryJoin[],
    context: {
      baseId: string;
      fieldMap: Record<string, IFieldInstance>;
      queryBuilder: Knex.QueryBuilder;
    }
  ) {
    const { baseId, fieldMap, queryBuilder } = context;
    let resFieldMap = { ...fieldMap };
    for (const join of joins) {
      const joinTable = join.table;
      const joinDbTableName = await this.getDbTableName(baseId, joinTable);
      const joinFieldMap = await this.getFieldMap(joinTable, joinDbTableName);
      const joinedField = fieldMap[join.on[0]];
      const joinField = joinFieldMap[join.on[1]];
      resFieldMap = { ...resFieldMap, ...joinFieldMap };
      switch (join.type) {
        case BaseQueryJoinType.Inner:
          queryBuilder.innerJoin(
            joinDbTableName,
            joinedField.dbFieldName,
            '=',
            joinField.dbFieldName
          );
          break;
        case BaseQueryJoinType.Left:
          queryBuilder.leftJoin(
            joinDbTableName,
            joinedField.dbFieldName,
            '=',
            joinField.dbFieldName
          );
          break;
        case BaseQueryJoinType.Right:
          queryBuilder.rightJoin(
            joinDbTableName,
            joinedField.dbFieldName,
            '=',
            joinField.dbFieldName
          );
          break;
        case BaseQueryJoinType.Full:
          queryBuilder.fullOuterJoin(
            joinDbTableName,
            joinedField.dbFieldName,
            '=',
            joinField.dbFieldName
          );
          break;
        default:
          throw new BadRequestException(`Invalid join type: ${join.type}`);
      }
    }
    return { queryBuilder, fieldMap: resFieldMap };
  }

  async getFieldMap(tableId: string, dbTableName?: string) {
    const fields = await this.fieldService.getFieldInstances(tableId, {});
    return fields.reduce(
      (acc, field) => {
        if (dbTableName) {
          field.dbFieldName = `${dbTableName}.${field.dbFieldName}`;
        }
        acc[field.id] = field;
        return acc;
      },
      {} as Record<string, IFieldInstance>
    );
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
}
