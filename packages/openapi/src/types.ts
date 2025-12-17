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
  Automation = 'automation',
  App = 'app',
  Dashboard = 'dashboard',
}

export const IS_TEMPLATE_HEADER = 'X-Tea-Template';
