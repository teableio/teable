import { z } from '../zod';

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

export const commentReactionSchema = z
  .object({
    reaction: z.string().emoji(),
    user: z.array(z.string()),
  })
  .array();

export const updateCommentReactionRoSchema = z.object({
  reaction: z.string().emoji(),
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
  includeCursor: z.string().or(z.boolean()).transform(Boolean).optional(),
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
  reaction: commentReactionSchema,
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
