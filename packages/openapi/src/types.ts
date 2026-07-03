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
export const BASE_SHARE_ID_HEADER = 'X-Tea-Base-Share';
export const SHARE_VIEW_ID_HEADER = 'X-Tea-Share-View';

/**
 * Tells analytics how a resource-creation request originated. Only used for
 * analytics segmentation — absence of the header means "manual" (an explicit
 * user action, e.g. clicking "Create base" on a blank space).
 */
export const CREATE_SOURCE_HEADER = 'X-Tea-Create-Source';

/** System-initiated, e.g. the base auto-created when a new user first enters their empty space. */
export const CREATE_SOURCE_AUTO = 'auto';
/** Created from a template (baked into the create-from-template API helper). */
export const CREATE_SOURCE_TEMPLATE = 'template';
/** Created by importing an existing base (baked into the import API helpers). */
export const CREATE_SOURCE_IMPORT = 'import';
