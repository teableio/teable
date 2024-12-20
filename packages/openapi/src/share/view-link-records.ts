import { axios } from '../axios';
import { getRecordsRoSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_LINK_RECORDS = '/share/{shareId}/view/link-records';

export enum ShareViewLinkRecordsType {
  Candidate = 'candidate',
  Selected = 'selected',
}

export const shareViewLinkRecordsRoSchema = getRecordsRoSchema
  .pick({
    take: true,
    skip: true,
  })
  .extend({
    fieldId: z.string(),
    search: z.string().optional(),
    type: z
      .nativeEnum(ShareViewLinkRecordsType)
      .optional()
      .openapi({ description: 'Only used for plugin views' }),
  });

export type IShareViewLinkRecordsRo = z.infer<typeof shareViewLinkRecordsRoSchema>;

export const shareViewLinkRecordsVoSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string().optional(),
  })
);

export type IShareViewLinkRecordsVo = z.infer<typeof shareViewLinkRecordsVoSchema>;

export const ShareViewLinkRecordsRoute = registerRoute({
  method: 'get',
  path: SHARE_VIEW_LINK_RECORDS,
  description:
    'In a view with a field selector, link the records list of the associated field selector to get the. Linking the desired ones inside the share view should fetch the ones that have already been selected.',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewLinkRecordsRoSchema,
  },
  responses: {
    200: {
      description: 'Link records list',
      content: {
        'application/json': {
          schema: shareViewLinkRecordsVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewLinkRecords = async (shareId: string, query: IShareViewLinkRecordsRo) => {
  return axios.get<IShareViewLinkRecordsVo>(urlBuilder(SHARE_VIEW_LINK_RECORDS, { shareId }), {
    params: query,
  });
};
