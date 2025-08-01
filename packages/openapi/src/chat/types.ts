import { z } from '../zod';

export enum McpToolInvocationName {
  GetTableFields = 'get-table-fields',
  GetTablesMeta = 'get-tables-meta',
  GetScriptInput = 'get-script-input',
  GetTeableApi = 'get-teable-api',
  GetTableViews = 'get-table-views',
  SqlQuery = 'sql-query',
  GenerateScriptAction = 'generate-script-action',
  UpdateBase = 'update-base',
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
  ResourceOperator = 'resource-operator-agent',
  TableOperator = 'table-operator-agent',
  FieldOperator = 'field-operator-agent',
  ViewOperator = 'view-operator-agent',
  RecordOperator = 'record-operator-agent',
  BuildBase = 'build-base-agent',
  BuildAutomation = 'build-automation-agent',
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

// table-agent
export const TableAgentOperator = {
  createTable: 'create-table',
  deleteTable: 'delete-table',
  updateTableName: 'update-table-name',
} as const;

export type ITableAgentOperator = (typeof TableAgentOperator)[keyof typeof TableAgentOperator];

// view-agent
export const ViewAgentOperator = {
  createView: 'create-view',
  deleteView: 'delete-view',
  updateViewName: 'update-view-name',
} as const;

export type IViewAgentOperator = (typeof ViewAgentOperator)[keyof typeof ViewAgentOperator];

// field-agent
export const FieldAgentOperator = {
  createFields: 'create-fields',
  deleteField: 'delete-field',
  updateField: 'update-field',
} as const;

export type IFieldAgentOperator = (typeof FieldAgentOperator)[keyof typeof FieldAgentOperator];

// record-agent
export const RecordAgentOperator = {
  createRecords: 'create-records',
  deleteRecords: 'delete-records',
  updateRecords: 'update-records',
} as const;

export type IRecordAgentOperator = (typeof RecordAgentOperator)[keyof typeof RecordAgentOperator];

export const ConfirmOperators = [
  TableAgentOperator.deleteTable,
  TableAgentOperator.updateTableName,
  ViewAgentOperator.deleteView,
  ViewAgentOperator.updateViewName,
  FieldAgentOperator.deleteField,
  FieldAgentOperator.updateField,
  RecordAgentOperator.deleteRecords,
  RecordAgentOperator.updateRecords,
] as const;

export const BuildBaseOperator = {
  updateBase: 'update-base',
  planTask: 'plan-task',
  generateTables: 'generate-tables',
  generatePrimaryFields: 'generate-primary-fields',
  generateFields: 'generate-fields',
  generateViews: 'generate-views',
  generateRecords: 'generate-records',
  generateAIFields: 'generate-ai-fields',
  generateLinkFields: 'generate-link-fields',
  generateLookupFields: 'generate-lookup-fields',
  generateLinkFieldsRecords: 'generate-link-fields-records',
} as const;

export const BuildAutomationOperator = {
  generateWorkflow: 'generate-workflow',
  generateTrigger: 'generate-trigger',
  generateAction: 'generate-action',
  generateScriptAction: 'generate-script-action',
  generateSendMailAction: 'generate-send-mail-action',
} as const;

export type IBuildBaseOperator = (typeof BuildBaseOperator)[keyof typeof BuildBaseOperator];

export type IBuildAutomationOperator =
  (typeof BuildAutomationOperator)[keyof typeof BuildAutomationOperator];
