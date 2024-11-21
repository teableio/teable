import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { ICalendarDailyCollectionVo } from '../aggregation';
import { calendarDailyCollectionRoSchema, calendarDailyCollectionVoSchema } from '../aggregation';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_CALENDAR_DAILY_COLLECTION =
  '/share/{shareId}/view/calendar-daily-collection';

export const shareViewCalendarDailyCollectionRoSchema = calendarDailyCollectionRoSchema.omit({
  viewId: true,
});

export type IShareViewCalendarDailyCollectionRo = z.infer<
  typeof shareViewCalendarDailyCollectionRoSchema
>;

export const ShareViewCalendarDailyCollectionRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_CALENDAR_DAILY_COLLECTION,
  description: 'Get calendar daily collection for the share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewCalendarDailyCollectionRoSchema,
  },
  responses: {
    200: {
      description: 'Calendar daily collection for the share view',
      content: {
        'application/json': {
          schema: calendarDailyCollectionVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewCalendarDailyCollection = async (
  shareId: string,
  query: IShareViewCalendarDailyCollectionRo
) => {
  return axios.get<ICalendarDailyCollectionVo>(
    urlBuilder(SHARE_VIEW_CALENDAR_DAILY_COLLECTION, { shareId }),
    {
      params: {
        ...query,
        filter: JSON.stringify(query.filter),
      },
    }
  );
};
