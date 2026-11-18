import { z } from '../zod';

/** What a chat app or social site shows for a template link: its name, description and cover. */
export const linkPreviewSchema = z.object({
  title: z.string(),
  description: z.string(),
  /** Absolute when storage has a public URL, else a path on this origin. */
  image: z.string().optional(),
});

export type ILinkPreview = z.infer<typeof linkPreviewSchema>;
