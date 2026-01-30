import { z } from './zod';

export const getListSchemaVo = <T>(item: z.ZodType<T>) => {
  return z.object({
    total: z.number(),
    list: z.array(item),
  });
};

export enum ResourceType {
  Space = 'space',
  Base = 'base',
  Table = 'table',
  View = 'view',
  Field = 'field',
  Record = 'record',
  Workflow = 'workflow',
  App = 'app',
  Dashboard = 'dashboard',
  Folder = 'folder',
}

export const IS_TEMPLATE_HEADER = 'X-Tea-Template';
