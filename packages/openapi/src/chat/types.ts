import { FieldType } from '@teable/core';
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

export const chatAttachmentSchema = z.object({
  path: z.string(),
  name: z.string(),
  mimetype: z.string(),
  size: z.number(),
  token: z.string(),
  presignedUrl: z.string().optional(),
});

export type IChatMessageAttachment = z.infer<typeof chatAttachmentSchema>;

export const chatContextSchema = z.object({
  webSearch: z.boolean().optional(),
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
  appId: z.string().optional(),
  sandboxId: z.string().optional(),
  attachments: z.array(chatAttachmentSchema).optional(),
  lang: z.string().optional(),
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

  // base relative
  TableOperator = 'table-operator-agent',
  FieldOperator = 'field-operator-agent',
  ViewOperator = 'view-operator-agent',
  RecordOperator = 'record-operator-agent',
  BuildBase = 'build-base-agent',

  // automation relative
  BuildAutomation = 'build-automation-agent',
  BuildScriptAction = 'build-script-action-agent',

  // app relative
  BuildApp = 'build-app-agent',
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
  TableAgentOperator.createTable,
  TableAgentOperator.deleteTable,
  TableAgentOperator.updateTableName,
  ViewAgentOperator.createView,
  ViewAgentOperator.deleteView,
  ViewAgentOperator.updateViewName,
  FieldAgentOperator.createFields,
  FieldAgentOperator.deleteField,
  FieldAgentOperator.updateField,
  RecordAgentOperator.createRecords,
  RecordAgentOperator.deleteRecords,
  RecordAgentOperator.updateRecords,
] as const;

export const BuildBaseOperator = {
  createTable: 'create-table',
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
  finishBuildBase: 'finish-build-base',
} as const;

export const BuildAutomationOperator = {
  generateWorkflow: 'generate-workflow',
  generateTrigger: 'generate-trigger',
  generateAction: 'generate-action',
  generateScriptAction: 'generate-script-action',
  generateSendMailAction: 'generate-send-mail-action',
} as const;

export const BuildScriptActionOperator = {
  getRelativeData: 'get-relative-data',
  getPreviousNodeOutputVariables: 'get-previous-node-output-variables',
  getApiJson: 'get-api-json',
  generateScriptAndDependencies: 'generate-script-and-dependencies',
} as const;

export const BuildAppOperator = {
  initialize: 'initialize',
  rename: 'rename',
  planTask: 'plan-task',
  buildTest: 'build-test',
  development: 'development',
  generateSummary: 'generate-summary',
  previewEnvironment: 'preview-environment',
  toolExecution: 'tool-execution',
} as const;

export type IBuildBaseOperator = (typeof BuildBaseOperator)[keyof typeof BuildBaseOperator];

export type IBuildScriptActionOperator =
  (typeof BuildScriptActionOperator)[keyof typeof BuildScriptActionOperator];

export type IBuildAutomationOperator =
  (typeof BuildAutomationOperator)[keyof typeof BuildAutomationOperator];

export type IBuildAppOperator = (typeof BuildAppOperator)[keyof typeof BuildAppOperator];

export enum ToolInvocationName {
  KnowledgeTool = 'knowledge-tool',
  WebSearch = 'web-search',
}

// build base types
export const COMMON_FIELD_TYPES = [
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultipleSelect,
  FieldType.Date,
  FieldType.Rating,
  FieldType.Checkbox,
  FieldType.Attachment,
  FieldType.User,
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
  FieldType.AutoNumber,
];

export enum FieldCategory {
  Common = 'common',
  Ai = 'ai',
  Link = 'link',
  Lookup = 'lookup',
  Rollup = 'rollup',
  Formula = 'formula',
}

export enum OperationType {
  CreateRecords = 'createRecords',
  CreateView = 'createView',
  CreateCommonField = 'createCommonField',
  CreateLinkField = 'createLinkField',
  CreateLookupField = 'createLookupField',
  CreateRollupField = 'createRollupField',
  CreateFormulaField = 'createFormulaField',
  CreateAiField = 'createAiField',
}

export enum ViewType {
  Grid = 'grid',
  Form = 'form',
  Kanban = 'kanban',
  Gallery = 'gallery',
  Calendar = 'calendar',
}

export enum RelationshipType {
  OneToOne = 'one-to-one',
  OneToMany = 'one-to-many',
  ManyToOne = 'many-to-one',
  ManyToMany = 'many-to-many',
}

export enum AggregationType {
  Sum = 'sum',
  Count = 'count',
  Average = 'average',
  Min = 'min',
  Max = 'max',
  Concatenate = 'concatenate',
}

// Main task plan schema
export const taskPlanSchema = z.object({
  plans: z
    .array(
      z
        .object({
          tableName: z.string().describe('Name of the table to create'),
          description: z.string().describe('Description of the table to create'),
          icon: z
            .string()
            .optional()
            .describe('Only one emoji icon of the table to create, no other text'),
          tasks: z.array(
            z.object({
              type: z.nativeEnum(OperationType).describe('IMPORTANT: Type of the task'),
              withSheetContext: z
                .boolean()
                .optional()
                .describe(
                  '1. Only set it to true when user gives [sheetContext] before\n' +
                    '2. Only set it to true when you are creating createRecords task'
                ),
              withAttachments: z
                .boolean()
                .optional()
                .describe(
                  '1. Only set it to true when user gives [attachments] before\n' +
                    '2. Only set it to true when you are creating createRecords task within a table with attachment field'
                ),
              description: z.string().describe(`
            Brief and accurate task description, including the following information based on task type:

            Create Common Field (createCommonField):
            - Generate field name and field type, separate by "|"
            - Only allowed these types: ${COMMON_FIELD_TYPES.join(', ')})
            - Example: "User name, text | Age, number | Birthday, date"

            Create Link Field (createLinkField):
            - Generate Link field name and Target table name and relationship type, separate by "|",
            - Relationship type: (one-to-one, one-to-many, many-to-one, many-to-many)
            - Example: "Collaborators, User, one-to-one | Tasks, Task, one-to-many"

            Create Lookup Field (createLookupField):
            - Generate field name, table name, lookup source field name separate by "|"
            - Example: "Task owner, Task, Owner | Deadline, Project, Project End Date"

            Create Rollup Field (createRollupField):
            - Generate field name, table name, rollup source field name and rollup function, separate by "|"
            - Aggregation type (sum, count, average, min, max, concatenate)
            - Example: "Total income, Orders, Price, sum | Average rating, Feedback, rating, average"

            Create Formula Field (createFormulaField):
            - Formula field name and related field names, purpose, separate by "|"
            - Example: "Total price, Order, Price, Low average transaction price warning | Distance, Route, Distance, sum"
            
            Create AI Field (createAiField):
            - AI field name and purpose, separate by "|"
            - Example: "Feedback, tag emotion | Attachment, extract price from pdf"

            Create Records (createRecords):
            - If user not provide [attachments] and [sheetContext] ask for generate 3 to 5 rows sample data.
            - If the user provides [attachments], instruct the AI agent to generate records so that each attachment is stored in a separate row.
            - If the user provides [sheetContext], the AI agent should generate records with records, based on the sheetContext.

            Create View (createView):
            - Generate view name and view type, separate by "|"
            - The view type only supports these types: grid, form, kanban, gallery, calendar
            - Example: "Overall, grid | Status, kanban"
          `),
            })
          ),
        })
        .describe('Task list for each table, each type of task only needs to be generated once.')
    )
    .describe('Array of tasks to execute in order'),
});

export type ITaskPlan = z.infer<typeof taskPlanSchema>;
