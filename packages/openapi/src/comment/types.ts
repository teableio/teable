import { z } from '../zod';
import type { EmojiSymbol } from './reaction';
import { SUPPORT_EMOJIS } from './reaction';

export enum CommentNodeType {
  // inline
  Text = 'span',
  Link = 'a',

  // block
  Paragraph = 'p',
  Img = 'img',

  // custom
  Mention = 'mention',
}

export enum CommentPatchType {
  CreateComment = 'create_comment',
  UpdateComment = 'update_comment',
  DeleteComment = 'delete_comment',

  CreateReaction = 'create_reaction',
  DeleteReaction = 'delete_reaction',
}

export const baseCommentContentSchema = z.object({
  type: z.nativeEnum(CommentNodeType),
  value: z.unknown(),
});

export const textCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Text),
  value: z.string(),
});

export const mentionCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Mention),
  value: z.string(),
});

export const imageCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Img),
  path: z.string(),
  width: z.number().optional(),
});

export const linkCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Link),
  url: z.string(),
  title: z.string(),
});

export const paragraphCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Paragraph),
  children: z.array(
    z.union([textCommentContentSchema, mentionCommentContentSchema, linkCommentContentSchema])
  ),
});

export const commentContentSchema = z
  .union([paragraphCommentContentSchema, imageCommentContentSchema])
  .array();

export type ICommentContent = z.infer<typeof commentContentSchema>;

export const createCommentRoSchema = z.object({
  quoteId: z.string().optional().nullable(),
  content: commentContentSchema,
});

export const updateCommentRoSchema = createCommentRoSchema.pick({
  content: true,
});

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

export const updateCommentReactionRoSchema = z.object({
  reaction: commentReactionSymbolSchema,
});

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

export type ICreateCommentRo = z.infer<typeof createCommentRoSchema>;

export type IUpdateCommentRo = z.infer<typeof updateCommentRoSchema>;

export type IUpdateCommentReactionRo = z.infer<typeof updateCommentReactionRoSchema>;

export type IGetCommentListQueryRo = z.infer<typeof getCommentListQueryRoSchema>;

export const commentPatchDataSchema = z.object({
  type: z.nativeEnum(CommentPatchType),
  data: z.record(z.unknown()),
});

export type ICommentPatchData = z.infer<typeof commentPatchDataSchema>;

export const commentSchema = z.object({
  id: z.string(),
  content: commentContentSchema,
  createdBy: z.string(),
  reaction: commentReactionSchema.optional().nullable(),
  createdTime: z.date(),
  lastModifiedTime: z.date(),
  quoteId: z.string().optional(),
  deletedTime: z.date().optional(),
});

export type ICommentVo = z.infer<typeof commentSchema>;

export const getCommentListVoSchema = z.object({
  comments: commentSchema.array(),
  nextCursor: z.string().optional().nullable(),
});

export const commentCountVoSchema = z
  .object({
    recordId: z.string(),
    count: z.number(),
  })
  .array();

export type ICommentCountVo = z.infer<typeof commentCountVoSchema>;

export type IGetCommentListVo = z.infer<typeof getCommentListVoSchema>;

export const commentNotifyVoSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
  createdBy: z.string(),
});

export type ICommentNotifyVo = z.infer<typeof commentNotifyVoSchema>;
