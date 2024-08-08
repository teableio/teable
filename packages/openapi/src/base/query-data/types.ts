import {
  baseFilterSetSchema,
  filterValueSchema,
  operators,
  orderSchema,
  refineExtendedFilterOperatorSchema,
  StatisticsFunc,
} from '@teable/core';
import { z } from '../../zod';

export enum BaseQueryColumnType {
  Aggregation = 'aggregation',
  Field = 'field',
}
export const baseQueryColumnTypeSchema = z.nativeEnum(BaseQueryColumnType);

export const baseQueryFilterItemSchema = z.object({
  column: z.string(),
  type: baseQueryColumnTypeSchema,
  value: filterValueSchema,
  operator: operators,
});

export type IBaseQueryFilterItem = z.infer<typeof baseQueryFilterItemSchema>;

export type IBaseQueryFilterSet = z.infer<typeof baseFilterSetSchema> & {
  filterSet: (IBaseQueryFilterItem | IBaseQueryFilterSet)[];
};

export const baseQueryFilterItemExtendSchema =
  refineExtendedFilterOperatorSchema(baseQueryFilterItemSchema);

export const baseQueryFilter: z.ZodType<IBaseQueryFilterSet> = baseFilterSetSchema.extend({
  filterSet: z.lazy(() => z.union([baseQueryFilterItemExtendSchema, baseQueryFilter]).array()),
});

export type IBaseQueryFilter = z.infer<typeof baseQueryFilter>;

export enum BaseQueryJoinType {
  Inner = 'INNER JOIN',
  Left = 'LEFT JOIN',
  Right = 'RIGHT JOIN',
  Full = 'FULL JOIN',
}

export const baseQueryJoinTypeSchema = z.nativeEnum(BaseQueryJoinType);

export const baseQueryJoinSchema = z.object({
  type: baseQueryJoinTypeSchema,
  table: z.string(),
  on: z.array(z.string(), z.string()).length(2),
});

export type IBaseQueryJoin = z.infer<typeof baseQueryJoinSchema>;

const baseQueryOrderBySchema = z.array(
  z.object({
    column: z.string(),
    type: baseQueryColumnTypeSchema,
    order: orderSchema,
  })
);
export type IBaseQueryOrderBy = z.infer<typeof baseQueryOrderBySchema>;

export const baseQueryGroupBySchema = z.array(
  z.object({
    column: z.string(),
    type: baseQueryColumnTypeSchema,
  })
);
export type IBaseQueryGroupBy = z.infer<typeof baseQueryGroupBySchema>;

export const baseQueryAggregationSchema = z.array(
  z.object({
    column: z.string(),
    type: baseQueryColumnTypeSchema,
    statisticFunc: z.nativeEnum(StatisticsFunc),
  })
);
export type IQueryAggregation = z.infer<typeof baseQueryAggregationSchema>;

export const baseQuerySelectSchema = z.object({
  type: baseQueryColumnTypeSchema,
  column: z.string(),
  alias: z.string().optional(),
});
export type IBaseQuerySelect = z.infer<typeof baseQuerySelectSchema>;

export const baseQueryNormalSqlQuery = z.object({
  select: z.array(baseQuerySelectSchema).optional(),
  groupBy: baseQueryGroupBySchema.optional(),
  orderBy: baseQueryOrderBySchema.optional(),
  where: baseQueryFilter.optional(),
  join: z.array(baseQueryJoinSchema).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  aggregation: baseQueryAggregationSchema.optional(),
  // distinct: z.array(z.string()).optional(),
});

export type IBaseQueryNormalSqlQuery = z.infer<typeof baseQueryNormalSqlQuery>;

export type IBaseQuery = IBaseQueryNormalSqlQuery & {
  from: string | IBaseQuery;
};

export const baseQuerySchema: z.ZodType<IBaseQuery> = baseQueryNormalSqlQuery.extend({
  from: z.lazy(() => z.union([baseQuerySchema, z.string()])),
});
