/* eslint-disable sonarjs/no-duplicate-string */
import { Controller, Get, Param, Query } from '@nestjs/common';
import type { IFilter } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IAggregationVo,
  ICalendarDailyCollectionVo,
  IGroupPointsVo,
  IRowCountVo,
  ISearchCountVo,
  ISearchIndexVo,
  ITaskStatusCollectionVo,
} from '@teable/openapi';
import {
  aggregationRoSchema,
  calendarDailyCollectionRoSchema,
  groupPointsRoSchema,
  IAggregationRo,
  IGroupPointsRo,
  IQueryBaseRo,
  searchCountRoSchema,
  ISearchCountRo,
  queryBaseSchema,
  ICalendarDailyCollectionRo,
  ISearchIndexByQueryRo,
  searchIndexByQueryRoSchema,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { PerformanceCacheService } from '../../../performance-cache';
import { generateAggCacheKey } from '../../../performance-cache/generate-keys';
import type { IClsStore } from '../../../types/cls';
import { filterHasMe } from '../../../utils/filter-has-me';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { TqlPipe } from '../../record/open-api/tql.pipe';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@Controller('api/table/:tableId/aggregation')
export class AggregationOpenApiController {
  constructor(
    private readonly aggregationOpenApiService: AggregationOpenApiService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  private async getAggregationWithCache<T>(
    cacheKeyPrefix: string,
    tableId: string,
    query: { filter?: IFilter; viewId?: string } | undefined,
    fn: () => Promise<T>
  ) {
    const table = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        lastModifiedTime: true,
      },
    });
    const viewId = query?.viewId;
    let viewFilter: string | null = null;
    if (viewId) {
      const view = await this.prismaService.view.findUniqueOrThrow({
        where: {
          id: viewId,
        },
        select: {
          filter: true,
        },
      });
      viewFilter = view.filter;
    }
    const cacheQuery =
      filterHasMe(query?.filter) || filterHasMe(viewFilter)
        ? { ...query, currentUserId: this.cls.get('user.id') }
        : query;

    const cacheKey = generateAggCacheKey(
      cacheKeyPrefix,
      tableId,
      table.lastModifiedTime?.getTime().toString() ?? '0',
      cacheQuery
    );
    return this.performanceCacheService.wrap(
      cacheKey,
      () => {
        return fn();
      },
      {
        ttl: 60 * 60, // 1 hour
      }
    );
  }

  @Get()
  @Permissions('table|read')
  async getAggregation(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(aggregationRoSchema), TqlPipe) query?: IAggregationRo
  ): Promise<IAggregationVo> {
    return await this.getAggregationWithCache('aggregation', tableId, query, () =>
      this.aggregationOpenApiService.getAggregation(tableId, query)
    );
  }

  @Get('/row-count')
  @Permissions('table|read')
  async getRowCount(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(queryBaseSchema), TqlPipe) query?: IQueryBaseRo
  ): Promise<IRowCountVo> {
    return await this.getAggregationWithCache('row_count', tableId, query, () =>
      this.aggregationOpenApiService.getRowCount(tableId, query)
    );
  }

  @Get('/search-count')
  @Permissions('table|read')
  async getSearchCount(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(searchCountRoSchema), TqlPipe) query: ISearchCountRo
  ): Promise<ISearchCountVo> {
    return await this.getAggregationWithCache('search_count', tableId, query, () =>
      this.aggregationOpenApiService.getSearchCount(tableId, query)
    );
  }

  @Get('/search-index')
  @Permissions('table|read')
  async getSearchIndex(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(searchIndexByQueryRoSchema), TqlPipe) query: ISearchIndexByQueryRo
  ): Promise<ISearchIndexVo> {
    return await this.getAggregationWithCache('search_index', tableId, query, () =>
      this.aggregationOpenApiService.getRecordIndexBySearchOrder(tableId, query)
    );
  }

  @Get('/group-points')
  @Permissions('table|read')
  async getGroupPoints(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(groupPointsRoSchema), TqlPipe) query?: IGroupPointsRo
  ): Promise<IGroupPointsVo> {
    return await this.getAggregationWithCache('group_points', tableId, query, () =>
      this.aggregationOpenApiService.getGroupPoints(tableId, query)
    );
  }

  @Get('/calendar-daily-collection')
  @Permissions('table|read')
  async getCalendarDailyCollection(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(calendarDailyCollectionRoSchema), TqlPipe)
    query: ICalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo> {
    return await this.getAggregationWithCache('calendar_daily_collection', tableId, query, () =>
      this.aggregationOpenApiService.getCalendarDailyCollection(tableId, query)
    );
  }

  @Get('/task-status-collection')
  @Permissions('table|read')
  async getTaskStatusCollection(
    @Param('tableId') _tableId: string
  ): Promise<ITaskStatusCollectionVo> {
    return {
      fieldMap: {},
      cells: [],
    };
  }
}
