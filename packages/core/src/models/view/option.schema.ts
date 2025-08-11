import { z } from '../../zod';
import { ViewType } from './constant';
import { calendarViewOptionSchema } from './derivate/calendar-view-option.schema';
import { formViewOptionSchema } from './derivate/form-view-option.schema';
import { galleryViewOptionSchema } from './derivate/gallery-view-option.schema';
import { gridViewOptionSchema } from './derivate/grid-view-option.schema';
import { kanbanViewOptionSchema } from './derivate/kanban-view-option.schema';
import { pluginViewOptionSchema } from './derivate/plugin-view-option.schema';

export const viewOptionsSchema = z.union([
  gridViewOptionSchema,
  kanbanViewOptionSchema,
  galleryViewOptionSchema,
  calendarViewOptionSchema,
  formViewOptionSchema,
  pluginViewOptionSchema,
]);

export type IViewOptions = z.infer<typeof viewOptionsSchema>;

// Re-export for convenience

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
