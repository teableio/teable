import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const TRACK_EVENT = '/user/track';

export const trackEventRoSchema = z.object({
  event: z.string().min(1).max(100),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export type ITrackEventRo = z.infer<typeof trackEventRoSchema>;

export const TrackEventRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TRACK_EVENT,
  description: 'Track a frontend event',
  request: {
    body: {
      content: {
        'application/json': {
          schema: trackEventRoSchema,
        },
      },
    },
  },
  responses: {
    204: {
      description: 'Event tracked successfully.',
    },
  },
  tags: ['user'],
});

export const trackEvent = async (trackEventRo: ITrackEventRo) => {
  return axios.post<void>(TRACK_EVENT, trackEventRo);
};
