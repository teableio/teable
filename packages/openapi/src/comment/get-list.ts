import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { commentSchema } from './get';

export const GET_COMMENT_LIST = '/comment/{tableId}/{recordId}/list';

export const getCommentListVoSchema = z.object({
  comments: commentSchema.array(),
  nextCursor: z.string().optional().nullable(),
});

export type IGetCommentListVo = z.infer<typeof getCommentListVoSchema>;

export const getCommentListQueryRoSchema = z.object({
  take: z
    .string()
    .or(z.number())
    .transform(Number)
    .pipe(
      z
        .number()
        .min(1, 'You should at least take 1 record')
        .max(1000, `Can't take more than ${1000} records, please reduce take count`)
    )
    .default(20)
    .optional()
    .openapi({
      example: 20,
      description: `The record count you want to take, maximum is ${1000}`,
    }),
  cursor: z.string().optional().nullable(),
  includeCursor: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
    .optional(),
  direction: z.union([z.literal('forward'), z.literal('backward')]).optional(),
});

export type IGetCommentListQueryRo = z.infer<typeof getCommentListQueryRoSchema>;

export const GetCommentListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_COMMENT_LIST,
  description: 'Get record comment list',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
    query: getCommentListQueryRoSchema,
  },
  responses: {
    200: {
      description: "Returns the list of record's comment",
      content: {
        'application/json': {
          schema: getCommentListVoSchema,
        },
      },
    },
  },
  tags: ['comment'],
});

export const getCommentList = async (
  tableId: string,
  recordId: string,
  getCommentListQueryRo: IGetCommentListQueryRo
) => {
  return axios.get<IGetCommentListVo>(urlBuilder(GET_COMMENT_LIST, { tableId, recordId }), {
    params: getCommentListQueryRo,
  });
};
