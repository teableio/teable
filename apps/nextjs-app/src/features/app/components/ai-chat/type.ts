export interface IChat {
  id: string;
  connectionId?: string;
  databaseName?: string;
  assistantId: string;
  title: string;
  createdAt: number;
  promptContext?: IPromptContext;
}

export enum PromptContextType {
  CreateTablePrompt = 'CREATE_TABLE_PROMPT',
  GenerateChartPrompt = 'GENERATE_CHART_PROMPT',
}

export type IPromptContext = {
  [key in PromptContextType]: string;
};
