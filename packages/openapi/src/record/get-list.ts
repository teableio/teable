import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import {
  FILTER_DESCRIPTION,
  filterSchema,
  groupSchema,
  IdPrefix,
  recordSchema,
  sortItemSchema,
} from '@teable/core';
import type { AxiosResponse } from 'axios';
import { groupPointsVoSchema } from '../aggregation/type';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { getRecordQuerySchema } from './get';
import { TQL_README } from './README';

const defaultPageSize = 100;
const maxPageSize = 2000;

export const queryBaseSchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View).optional().openapi({
    example: 'viwXXXXXXX',
    description:
      'Set the view you want to fetch, default is first view. result will filter and sort by view options.',
  }),
  filterByTql: z.string().optional().openapi({
    example: "{field} = 'Completed' AND {field} > 5",
    description: TQL_README,
  }),
  filter: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value == null) {
        return value;
      }

      const parsingResult = filterSchema.safeParse(JSON.parse(value));
      if (!parsingResult.success) {
        parsingResult.error.issues.forEach((issue) => {
          ctx.addIssue(issue);
        });
        return z.NEVER;
      }
      return parsingResult.data;
    })
    .openapi({
      type: 'string',
      description: FILTER_DESCRIPTION,
    }),
  search: z
    .union([
      z.tuple([z.string()]),
      z.tuple([z.string(), z.string()]),
      z.tuple([
        z.string(),
        z.string(),
        z.union([
          z.string().transform((val) => {
            if (val === 'true') {
              return true;
            } else if (val === 'false') {
              return false;
            }
            return true;
          }),
          z.boolean(),
        ]),
      ]),
    ])
    .optional()
    // because of the https params only be string, so the boolean params should transform
    .openapi({
      default: ['searchValue', 'fieldIdOrName', false],
      description: 'Search for records that match the specified field and value',
    }),
  filterLinkCellCandidate: z
    .tuple([z.string().startsWith(IdPrefix.Field), z.string().startsWith(IdPrefix.Record)])
    .or(z.string().startsWith(IdPrefix.Field))
    .optional()
    .openapi({
      example: ['fldXXXXXXX', 'recXXXXXXX'],
      description:
        'Filter out the records that can be selected by a given link cell from the relational table. For example, if the specified field is one to many or one to one relationship, recordId for which the field has already been selected will not appear.',
    }),
  filterLinkCellSelected: z
    .tuple([z.string().startsWith(IdPrefix.Field), z.string().startsWith(IdPrefix.Record)])
    .or(z.string().startsWith(IdPrefix.Field))
    .optional()
    .openapi({
      example: ['fldXXXXXXX', 'recXXXXXXX'],
      description:
        'Filter out selected records based on this link cell from the relational table. Note that viewId, filter, and orderBy will not take effect in this case because selected records has it own order. Ignoring recordId gets all the selected records for the field',
    }),
  selectedRecordIds: z.array(z.string().startsWith(IdPrefix.Record)).optional().openapi({
    description: 'Filter selected records by record ids',
  }),
});

export type IQueryBaseRo = z.infer<typeof queryBaseSchema>;

const orderByDescription =
  'An array of sort objects that specifies how the records should be ordered.';

export const orderBySchema = sortItemSchema.array().openapi({
  type: 'array',
  description: orderByDescription,
});

// with orderBy for content related fetch
export const contentQueryBaseSchema = queryBaseSchema.extend({
  orderBy: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value == null) {
        return value;
      }

      const parsingResult = orderBySchema.safeParse(JSON.parse(value));
      if (!parsingResult.success) {
        parsingResult.error.issues.forEach((issue) => {
          ctx.addIssue(issue);
        });
        return z.NEVER;
      }
      return parsingResult.data;
    })
    .openapi({
      type: 'string',
      description: orderByDescription,
    }),
  groupBy: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value == null) {
        return value;
      }

      const parsingResult = groupSchema.safeParse(JSON.parse(value));
      if (!parsingResult.success) {
        parsingResult.error.issues.forEach((issue) => {
          ctx.addIssue(issue);
        });
        return z.NEVER;
      }
      return parsingResult.data;
    })
    .openapi({
      type: 'string',
      description: 'An array of group objects that specifies how the records should be grouped.',
    }),
  collapsedGroupIds: z.array(z.string()).optional().openapi({
    description: 'An array of group ids that specifies which groups are collapsed',
  }),
});

export const getRecordsRoSchema = getRecordQuerySchema.merge(contentQueryBaseSchema).extend({
  take: z
    .string()
    .or(z.number())
    .transform(Number)
    .pipe(
      z
        .number()
        .min(1, 'You should at least take 1 record')
        .max(maxPageSize, `Can't take more than ${maxPageSize} records, please reduce take count`)
    )
    .default(defaultPageSize)
    .optional()
    .openapi({
      example: defaultPageSize,
      description: `The record count you want to take, maximum is ${maxPageSize}`,
    }),
  skip: z
    .string()
    .or(z.number())
    .transform(Number)
    .pipe(z.number().min(0, 'You can not skip a negative count of records'))
    .default(0)
    .optional()
    .openapi({
      example: 0,
      description: 'The records count you want to skip',
    }),
});

export type IGetRecordsRo = z.infer<typeof getRecordsRoSchema>;

export const recordsSchema = recordSchema.array().openapi({
  example: [
    {
      id: 'recXXXXXXX',
      fields: {
        'single line text': 'text value',
      },
    },
  ],
  description: 'Array of record objects ',
});

export const recordsVoSchema = z.object({
  records: recordSchema.array().openapi({
    example: [
      {
        id: 'recXXXXXXX',
        fields: {
          'single line text': 'text value',
        },
      },
    ],
    description: 'Array of record objects ',
  }),
  offset: z.string().optional().openapi({
    description:
      'If more records exist, the response includes an offset. Use this offset for fetching the next page of records.',
  }),
  extra: z
    .object({
      groupPoints: groupPointsVoSchema.optional().openapi({
        description: 'Group points for the view',
      }),
    })
    .optional(),
});

export type IRecordsVo = z.infer<typeof recordsVoSchema>;

export const GET_RECORDS_URL = '/table/{tableId}/record';

export const GetRecordsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_RECORDS_URL,
  description: 'Get multiple records',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: getRecordsRoSchema,
  },
  responses: {
    200: {
      description: 'List of records',
      content: {
        'application/json': {
          schema: recordsVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export async function getRecords(
  tableId: string,
  query?: IGetRecordsRo
): Promise<AxiosResponse<IRecordsVo>> {
  // Add serialization for complex query parameters
  const serializedQuery = {
    ...query,
    filter: query?.filter ? JSON.stringify(query.filter) : undefined,
    orderBy: query?.orderBy ? JSON.stringify(query.orderBy) : undefined,
    groupBy: query?.groupBy ? JSON.stringify(query.groupBy) : undefined,
  };

  return axios.get<IRecordsVo>(urlBuilder(GET_RECORDS_URL, { tableId }), {
    params: serializedQuery,
  });
}
