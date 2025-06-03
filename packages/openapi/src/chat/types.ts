import { z } from '../zod';

export enum McpToolInvocationName {
  GetTableFields = 'get-table-fields',
  GetTablesMeta = 'get-tables-meta',
  SqlQuery = 'sql-query',
}

export const chatContextSchema = z.object({
  tables: z
    .array(
      z.object({
        id: z.string(),
        viewId: z.string().optional(),
      })
    )
    .optional(),
});

export type IChatContext = z.infer<typeof chatContextSchema>;

export type IChatMessageUsage = {
  promptTokens: number;
  completionTokens: number;
  credit?: number;
};
