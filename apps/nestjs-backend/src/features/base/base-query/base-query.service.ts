import { Injectable, Logger } from '@nestjs/common';
import { CellFormat, FieldType, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { BaseQueryColumnType, BaseQueryJoinType } from '@teable/openapi';
import type { IBaseQueryJoin, IBaseQuery, IBaseQueryVo, IBaseQueryColumn } from '@teable/openapi';
import {
  presignAttachmentCellValue,
  v2CoreTokens,
  type IAttachmentUrlSignerService,
} from '@teable/v2-core';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { DatabaseRouter } from '../../../global/database-router.service';
import { DATA_KNEX } from '../../../global/knex/knex.module';
import type { IClsStore } from '../../../types/cls';
import { throwV2QueryDomainError } from '../../aggregation/open-api/aggregation-v2-result.mapper';
import { FieldOpenApiV2Service } from '../../field/open-api/field-open-api-v2.service';
import {
  convertFieldInstanceToFieldVo,
  createFieldInstanceByVo,
  type IFieldInstance,
} from '../../field/model/factory';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2RecordQueryPlanService, toKnexRecordQuery } from '../../v2/v2-record-query-plan.service';
import { QueryAggregation } from './parse/aggregation';
import { QueryFilter } from './parse/filter';
import { QueryGroup } from './parse/group';
import { QueryOrder } from './parse/order';
import { QuerySelect } from './parse/select';
import { getQueryColumnTypeByFieldInstance } from './parse/utils';

@Injectable()
export class BaseQueryService {
  private readonly logger = new Logger(BaseQueryService.name);

  constructor(
    @InjectModel(DATA_KNEX) private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,

    private readonly fieldService: FieldOpenApiV2Service,
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    private readonly cls: ClsService<IClsStore>,
    private readonly v2ContainerService: V2ContainerService,
    private readonly recordQueryPlanService: V2RecordQueryPlanService
  ) {}

  private getQueryColumnName(field: IFieldInstance): string {
    return field.dbFieldName;
  }

  // Quote an identifier if not already quoted
  private quoteIdentifier(name: string): string {
    if (!name) return name as unknown as string;
    if (name.includes('.')) {
      return name
        .split('.')
        .filter((part) => part.length > 0)
        .map((part) => this.quoteIdentifier(part))
        .join('.');
    }
    const trimmed = name.replace(/^"+|(?<!")"+$/g, '');
    const escaped = trimmed.replaceAll('"', '""');
    return `"${escaped}"`;
  }

  // Quote a composite table name like schema.table
  private quoteDbTableName(dbTableName: string): string {
    return dbTableName
      .split('.')
      .filter((part) => part.length > 0)
      .map((part) => this.quoteIdentifier(part))
      .join('.');
  }

  private convertFieldMapToColumn(fieldMap: Record<string, IFieldInstance>): IBaseQueryColumn[] {
    return Object.values(fieldMap).map((field) => {
      const type = getQueryColumnTypeByFieldInstance(field);

      return {
        column: type === BaseQueryColumnType.Field ? this.getQueryColumnName(field) : field.id,
        name: field.name,
        type,
        fieldSource:
          type === BaseQueryColumnType.Field ? convertFieldInstanceToFieldVo(field) : undefined,
      };
    });
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async dbRows2Rows(
    baseId: string,
    rows: Record<string, unknown>[],
    columns: IBaseQueryColumn[],
    cellFormat: CellFormat
  ) {
    const resRows: Record<string, unknown>[] = [];
    let signer: IAttachmentUrlSignerService | undefined;
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
          if (!signer) {
            const container = await this.v2ContainerService.getContainerForBase(baseId);
            signer = container.resolve<IAttachmentUrlSignerService>(
              v2CoreTokens.attachmentUrlSignerService
            );
          }
          const signed = await presignAttachmentCellValue(cellValue, signer);
          if (signed.isErr()) throwV2QueryDomainError(signed.error);
          resRow[field.column] = signed.value;
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
    const rows = await this.databaseRouter
      .queryDataPrismaForBase<{ [key in string]: unknown }[]>(baseId, query)
      .catch((e) => {
        this.logger.error(e);
        throw new CustomHttpException('Query failed', HttpErrorCode.VALIDATION_ERROR, {
          localization: {
            i18nKey: 'httpErrors.baseQuery.queryFailed',
            context: {
              query,
              message: e.message,
            },
          },
        });
      });
    const columns = this.convertFieldMapToColumn(fieldMap);
    return {
      rows: await this.dbRows2Rows(baseId, rows, columns, cellFormat),
      columns,
    };
  }

  async parseBaseQuery(
    baseId: string,
    baseQuery: IBaseQuery,
    depth: number = 0
  ): Promise<{ queryBuilder: Knex.QueryBuilder; fieldMap: Record<string, IFieldInstance> }> {
    if (typeof baseQuery.from === 'string') {
      await this.getDbTableName(baseId, baseQuery.from);
      const dbTableName = baseQuery.from;
      const plan = await this.recordQueryPlanService.compile(baseQuery.from, undefined, {
        order: 'none',
      });
      const source = toKnexRecordQuery(this.knex, plan);
      const queryBuilder = this.knex
        .queryBuilder()
        .from(this.knex.raw('(?) as ??', [source, dbTableName]));
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
          const original = fieldMap[key];
          const lastSegment = (original.dbFieldName ?? '').split('.').pop() as string;
          const isAggregation =
            getQueryColumnTypeByFieldInstance(original) === BaseQueryColumnType.Aggregation;
          acc[key] = createFieldInstanceByVo({
            ...original,
            // 对于聚合字段，外层应按聚合别名排序/筛选，因此只保留别名本身，避免再加表别名导致歧义
            dbFieldName: isAggregation
              ? this.quoteIdentifier(lastSegment)
              : `${this.quoteIdentifier(alias)}.${this.quoteIdentifier(lastSegment)}`,
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
        knex: this.knex,
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

    const unquotePath = (ref: string) => ref.replaceAll('"', '');
    for (const join of joins) {
      const joinTable = join.table;
      await this.getDbTableName(baseId, joinTable);
      const joinDbTableName = joinTable;
      const plan = await this.recordQueryPlanService.compile(joinTable, undefined, {
        order: 'none',
      });
      const joinSource = this.knex.raw('(?) as ??', [
        toKnexRecordQuery(this.knex, plan),
        joinDbTableName,
      ]);
      const joinFieldMap = await this.getFieldMap(joinTable, joinDbTableName);
      const joinedField = fieldMap[join.on[0]];
      const joinField = joinFieldMap[join.on[1]];
      resFieldMap = { ...resFieldMap, ...joinFieldMap };
      switch (join.type) {
        case BaseQueryJoinType.Inner:
          queryBuilder.innerJoin(
            joinSource,
            this.knex.raw('?? = ??', [
              unquotePath(joinedField.dbFieldName),
              unquotePath(joinField.dbFieldName),
            ])
          );
          break;
        case BaseQueryJoinType.Left:
          queryBuilder.leftJoin(
            joinSource,
            this.knex.raw('?? = ??', [
              unquotePath(joinedField.dbFieldName),
              unquotePath(joinField.dbFieldName),
            ])
          );
          break;
        case BaseQueryJoinType.Right:
          queryBuilder.rightJoin(
            joinSource,
            this.knex.raw('?? = ??', [
              unquotePath(joinedField.dbFieldName),
              unquotePath(joinField.dbFieldName),
            ])
          );
          break;
        case BaseQueryJoinType.Full:
          queryBuilder.fullOuterJoin(
            joinSource,
            this.knex.raw('?? = ??', [
              unquotePath(joinedField.dbFieldName),
              unquotePath(joinField.dbFieldName),
            ])
          );
          break;
        default:
          throw new CustomHttpException('Invalid join type', HttpErrorCode.VALIDATION_ERROR, {
            localization: {
              i18nKey: 'httpErrors.baseQuery.invalidJoinType',
              context: {
                joinType: join.type,
              },
            },
          });
      }
    }
    return { queryBuilder, fieldMap: resFieldMap };
  }

  async getFieldMap(tableId: string, dbTableName?: string) {
    const fields = (await this.fieldService.getFields(tableId)).map(createFieldInstanceByVo);
    return fields.reduce(
      (acc, field) => {
        if (dbTableName) {
          const qualifiedTable = this.quoteDbTableName(dbTableName);
          const rawFieldName = field.dbFieldName ?? '';
          const columnSegment = rawFieldName.split('.').pop() ?? rawFieldName;
          const isSimpleIdentifier =
            !!columnSegment && /^[\w"]+$/.test(columnSegment.replace(/^"+|(?<!")"+$/g, ''));
          field.dbFieldName =
            columnSegment && isSimpleIdentifier
              ? `${qualifiedTable}.${this.quoteIdentifier(columnSegment)}`
              : rawFieldName;
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
        throw new CustomHttpException('Table not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseQuery.tableNotFound',
            context: {
              tableId,
              baseId,
            },
          },
        });
      });
    return tableMeta.dbTableName;
  }
}
