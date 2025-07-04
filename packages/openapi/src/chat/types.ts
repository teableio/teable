import { z } from '../zod';

export enum McpToolInvocationName {
  GetTableFields = 'get-table-fields',
  GetTablesMeta = 'get-tables-meta',
  SqlQuery = 'sql-query',
  GenerateScriptAction = 'generate-script-action',
  GetScriptInput = 'get-script-input',
  GetTeableApi = 'get-teable-api',
}

export const chatContextSchema = z.object({
  tools: z.array(z.nativeEnum(McpToolInvocationName)).optional(),
  tables: z
    .array(
      z.object({
        id: z.string(),
        viewId: z.string().optional(),
      })
    )
    .optional(),
  workflowId: z.string().optional(),
  actionId: z.string().optional(),
});

export type IChatContext = z.infer<typeof chatContextSchema>;

export type IChatMessageUsage = {
  promptTokens: number;
  completionTokens: number;
  credit?: number;
};

export enum AgentInvocationName {
  DataVisualization = 'data-visualization-agent',
  Sql = 'sql-agent',
}

export type IDataVisualizationDataStream = {
  type: 'tool-invocation';
  data: {
    toolCallId: string;
    toolName: AgentInvocationName.DataVisualization;
    state: 'progress' | 'finish';
    code?: string;
  };
};

export type IDataVisualizationAgentResult = {
  filePath?: string;
  error?: string;
};
