import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import type { EmojiSymbol } from './constant';
import { SUPPORT_EMOJIS } from './constant';

export const CREATE_COMMENT_REACTION = '/comment/{tableId}/{recordId}/{commentId}/reaction';

export const commentReactionSymbolSchema = z
  .string()
  .emoji()
  .refine((value) => {
    return SUPPORT_EMOJIS.includes(value as EmojiSymbol);
  });

export const commentReactionSchema = z
  .object({
    reaction: commentReactionSymbolSchema,
    user: z.array(z.string()),
  })
  .array();

export type ICommentReaction = z.infer<typeof commentReactionSchema>;

export const commentReactionDetailSchema = z
  .object({
    reaction: commentReactionSymbolSchema,
    user: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        avatar: z.string().optional(),
      })
    ),
  })
  .array();

export type ICommentReactionDetail = z.infer<typeof commentReactionDetailSchema>;

export const updateCommentReactionRoSchema = z.object({
  reaction: commentReactionSymbolSchema,
});

export type IUpdateCommentReactionRo = z.infer<typeof updateCommentReactionRoSchema>;

export const CreateCommentReactionRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_COMMENT_REACTION,
  description: 'create record comment reaction',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
      commentId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateCommentReactionRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully create comment reaction.',
    },
  },
  tags: ['comment'],
});

export const createCommentReaction = async (
  tableId: string,
  recordId: string,
  commentId: string,
  createCommentReactionRo: IUpdateCommentReactionRo
) => {
  return axios.patch<void>(
    urlBuilder(CREATE_COMMENT_REACTION, { tableId, recordId, commentId }),
    createCommentReactionRo
  );
};
