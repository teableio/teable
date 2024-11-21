import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { recordSchema } from '@teable/core';
import { axios } from '../axios';
import { contentQueryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const calendarDailyCollectionRoSchema = contentQueryBaseSchema
  .pick({
    viewId: true,
    filter: true,
    search: true,
  })
  .merge(
    z.object({
      startDate: z.string(),
      endDate: z.string(),
      startDateFieldId: z.string(),
      endDateFieldId: z.string(),
    })
  );

export type ICalendarDailyCollectionRo = z.infer<typeof calendarDailyCollectionRoSchema>;

export const calendarDailyCollectionVoSchema = z.object({
  countMap: z.record(z.string(), z.number()),
  records: z.array(recordSchema),
});

export type ICalendarDailyCollectionVo = z.infer<typeof calendarDailyCollectionVoSchema>;

export const GET_CALENDAR_DAILY_COLLECTION =
  '/table/{tableId}/aggregation/calendar-daily-collection';

export const GetCalendarDailyCollectionRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_CALENDAR_DAILY_COLLECTION,
  description: 'Get calendar daily collection for the view',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: calendarDailyCollectionRoSchema,
  },
  responses: {
    200: {
      description: 'Calendar daily collection for the view',
      content: {
        'application/json': {
          schema: calendarDailyCollectionVoSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getCalendarDailyCollection = async (
  tableId: string,
  query?: ICalendarDailyCollectionRo
) => {
  return axios.get<ICalendarDailyCollectionVo>(
    urlBuilder(GET_CALENDAR_DAILY_COLLECTION, { tableId }),
    {
      params: {
        ...query,
        filter: JSON.stringify(query?.filter),
      },
    }
  );
};
