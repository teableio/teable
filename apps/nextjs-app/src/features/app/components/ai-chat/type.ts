export interface IChat {
  id: string;
  connectionId?: string;
  databaseName?: string;
  assistantId: string;
  title: string;
  createdAt: number;
}
