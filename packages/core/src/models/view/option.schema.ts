import z from 'zod';
import { ViewType } from './constant';
import { kanbanViewOptionSchema, gridViewOptionSchema, formViewOptionSchema } from './derivate';
import { pluginViewOptionSchema } from './derivate/plugin.view';

export const viewOptionsSchema = z.union([
  gridViewOptionSchema,
  kanbanViewOptionSchema,
  formViewOptionSchema,
  pluginViewOptionSchema,
]);

export type IViewOptions = z.infer<typeof viewOptionsSchema>;

export const validateOptionsType = (type: ViewType, optionsString: IViewOptions): string | void => {
  switch (type) {
    case ViewType.Grid:
      gridViewOptionSchema.parse(optionsString);
      break;
    case ViewType.Kanban:
      kanbanViewOptionSchema.parse(optionsString);
      break;
    case ViewType.Form:
      formViewOptionSchema.parse(optionsString);
      break;
    case ViewType.Plugin:
      pluginViewOptionSchema.parse(optionsString);
      break;
    default:
      throw new Error(`Unsupported view type: ${type}`);
  }
};
