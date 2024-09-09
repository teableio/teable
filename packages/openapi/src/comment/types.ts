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
  url: z.string(),
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

export const commentReactionSchema = z
  .object({
    reaction: z.string(),
    user: z.array(z.string()),
  })
  .array();

export type ICreateCommentRo = z.infer<typeof createCommentRoSchema>;

export const updateCommentRoSchema = createCommentRoSchema
  .pick({
    content: true,
  })
  .extend({
    reaction: z.string(),
  });

export type IUpdateCommentRo = z.infer<typeof updateCommentRoSchema>;

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
