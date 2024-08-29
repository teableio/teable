import { z } from '../zod';

export enum CommentNodeType {
  Text = 'text',
  Mention = 'mention',
  Paragraph = 'paragraph',
}

export const commentItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdBy: z.string(),
  lastModifiedBy: z.string(),
  createdTime: z.date(),
  lastModifiedTime: z.date(),
});

export type ICommentItem = z.infer<typeof commentItemSchema>;

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

export const paragraphCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Paragraph),
  children: z.array(z.union([textCommentContentSchema, mentionCommentContentSchema])),
});

export const commentContentSchema = z.union([
  textCommentContentSchema,
  mentionCommentContentSchema,
]);

export type ICommentVo = ICommentItem;

export const updateCommentRoSchema = z.object({
  content: paragraphCommentContentSchema.array(),
});

export type IUpdateCommentRo = z.infer<typeof updateCommentRoSchema>;

export const createCommentRoSchema = updateCommentRoSchema.extend({
  parentId: z.string().optional().nullable(),
});

export type ICreateCommentRo = z.infer<typeof createCommentRoSchema>;
