import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import type { ICopyVo, IRangesRo } from '../selection';
import { copyVoSchema, rangesQuerySchema } from '../selection';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_COPY = '/share/{shareId}/view/copy';

const shareCopyRangesSchema = z
  .string()
  .transform((value, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'ranges must be valid JSON' });
      return z.NEVER;
    }
    const result = z
      .array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]))
      .min(1)
      .safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
      }
      return z.NEVER;
    }
    return result.data;
  })
  .meta({
    type: 'string',
    description: 'Selection coordinates encoded as JSON',
    example: '[[0, 0], [1, 1]]',
  });

export const shareViewCopyQuerySchema = rangesQuerySchema
  .pick({
    filterByTql: true,
    filter: true,
    search: true,
    orderBy: true,
    groupBy: true,
    collapsedGroupIds: true,
    queryId: true,
    projection: true,
    ranges: true,
    type: true,
  })
  .extend({ ranges: shareCopyRangesSchema })
  .superRefine((value, ctx) => {
    if (value.type == null && value.ranges.length !== 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['ranges'],
        message: 'Cell selections require exactly two coordinates',
      });
      return;
    }
    if (
      value.type == null &&
      (value.ranges[0]![0] > value.ranges[1]![0] || value.ranges[0]![1] > value.ranges[1]![1])
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['ranges'],
        message: 'Cell selection coordinates must be ordered from top-left to bottom-right',
      });
      return;
    }
    if (value.type != null) {
      value.ranges.forEach(([start, end], index) => {
        if (start > end) {
          ctx.addIssue({
            code: 'custom',
            path: ['ranges', index],
            message: 'Selection ranges must be ascending',
          });
        }
      });
    }
  });

export type IShareViewCopyQuery = z.infer<typeof shareViewCopyQuerySchema>;

export const ShareViewCopyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_COPY,
  description: 'Copy operations in Share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewCopyQuerySchema,
  },
  responses: {
    200: {
      description: 'Copy content',
      content: {
        'application/json': {
          schema: copyVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const shareViewCopy = async (shareId: string, copyRo: IRangesRo) => {
  return axios.get<ICopyVo>(
    urlBuilder(SHARE_VIEW_COPY, {
      shareId,
    }),
    {
      params: {
        ...copyRo,
        filter: JSON.stringify(copyRo.filter),
        orderBy: JSON.stringify(copyRo.orderBy),
        ranges: JSON.stringify(copyRo.ranges),
        groupBy: JSON.stringify(copyRo.groupBy),
        collapsedGroupIds: JSON.stringify(copyRo.collapsedGroupIds),
      },
    }
  );
};
