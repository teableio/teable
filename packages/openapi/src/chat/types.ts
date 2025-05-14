import { getRecordsRoSchema } from '../record';
import { z } from '../zod';

export enum McpToolInvocationName {
  GetTableFields = 'get-table-fields',
  GetTablesMeta = 'get-tables-meta',
  SqlQuery = 'sql-query',
}

export const chatContextSchema = z.object({
  tableIds: z.array(z.string()).optional(),
  viewIds: z.array(z.string()).optional(),
  tableQuery: getRecordsRoSchema
    .pick({
      filter: true,
      search: true,
      groupBy: true,
      orderBy: true,
      projection: true,
      ignoreViewQuery: true,
    })
    .optional(),
});

export type IChatContext = z.infer<typeof chatContextSchema>;

export type IChatMessageUsage = {
  promptTokens: number;
  completionTokens: number;
  credit?: number;
};
