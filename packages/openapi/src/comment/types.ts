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
  value: z.unknown().optional(),
});

export const textCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Text),
  value: z.string(),
});

export const mentionCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Mention),
  value: z.string(),
  name: z.string().optional(),
  avatar: z.string().optional(),
});

export const linkCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Link),
  url: z.string(),
  title: z.string(),
});

export const imageCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Img),
  path: z.string(),
  width: z.number().optional(),
  url: z.string().optional(),
});

export const paragraphCommentContentSchema = baseCommentContentSchema.extend({
  type: z.literal(CommentNodeType.Paragraph),
  children: z.array(
    z.union([textCommentContentSchema, mentionCommentContentSchema, linkCommentContentSchema])
  ),
});

export type IParagraphCommentContent = z.infer<typeof paragraphCommentContentSchema>;

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

export type ICreateCommentRo = z.infer<typeof createCommentRoSchema>;

export type IUpdateCommentRo = z.infer<typeof updateCommentRoSchema>;

export const commentPatchDataSchema = z.object({
  type: z.nativeEnum(CommentPatchType),
  data: z.record(z.unknown()),
});

export type ICommentPatchData = z.infer<typeof commentPatchDataSchema>;
