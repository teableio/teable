import z from 'zod';
import { ViewType } from './constant';
import {
  kanbanViewOptionSchema,
  gridViewOptionSchema,
  formViewOptionSchema,
  galleryViewOptionSchema,
} from './derivate';
import { calendarViewOptionSchema } from './derivate/calendar.view';
import { pluginViewOptionSchema } from './derivate/plugin.view';

export const viewOptionsSchema = z.union([
  gridViewOptionSchema,
  kanbanViewOptionSchema,
  galleryViewOptionSchema,
  calendarViewOptionSchema,
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
    case ViewType.Gallery:
      galleryViewOptionSchema.parse(optionsString);
      break;
    case ViewType.Calendar:
      calendarViewOptionSchema.parse(optionsString);
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
